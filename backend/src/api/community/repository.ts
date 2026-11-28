import { randomBytes } from 'node:crypto';
import { and, eq, getTableColumns, gte, inArray, isNull, lte, min, ne, or } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import {
  type CommunityStat,
  communityNoiseKeys,
  communityRefreshes,
  communityReleaseMembers,
  communityStats,
  expenses,
  insurancePolicies,
  insuranceTerms,
  type NewCommunityStat,
  odometerEntries,
  userPreferences,
  vehicles,
} from '../../db/schema';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences } from '../../types';
import { chunk, rowsPerInsert } from '../../utils/chunk';
import {
  COMMUNITY_SCHEMA_VERSION,
  type CommunityExpense,
  type CommunityVehicle,
  type InsurancePremium,
} from './aggregator';

export interface CommunityInput {
  optedInOwners: number;
  vehicles: CommunityVehicle[];
}

function pickTime(
  pick: (...times: number[]) => number,
  dates: (Date | null | undefined)[]
): Date | null {
  const times = dates.flatMap((date) => (date ? [date.getTime()] : []));
  return times.length > 0 ? new Date(pick(...times)) : null;
}

const OWNER_COLUMNS = {
  userId: userPreferences.userId,
  currency: userPreferences.currencyUnit,
  region: userPreferences.communityRegion,
};

const VEHICLE_COLUMNS = {
  id: vehicles.id,
  userId: vehicles.userId,
  catalogModelId: vehicles.catalogModelId,
  year: vehicles.year,
  vehicleType: vehicles.vehicleType,
  vehicleKind: vehicles.vehicleKind,
  unitPreferences: vehicles.unitPreferences,
};

export type Contribution = 'opted_out' | 'awaiting_refresh' | 'included';

export class CommunityStatsRepository {
  constructor(private db: AsyncAppDatabase) {}

  async loadOptedIn(windowStart: Date, windowEnd: Date): Promise<CommunityInput> {
    const owners = await this.db
      .select(OWNER_COLUMNS)
      .from(userPreferences)
      .where(eq(userPreferences.communityStatsOptIn, true));
    const ownerById = new Map(owners.map((owner) => [owner.userId, owner]));

    const result: CommunityVehicle[] = [];
    for (const ownerIds of chunk([...ownerById.keys()])) {
      const ownedVehicles = await this.db
        .select(VEHICLE_COLUMNS)
        .from(vehicles)
        .where(inArray(vehicles.userId, ownerIds));
      for (const batch of chunk(ownedVehicles)) {
        result.push(...(await this.loadBatch(batch, ownerById, windowStart, windowEnd)));
      }
    }
    return { optedInOwners: owners.length, vehicles: result };
  }

  async loadVehicle(
    vehicleId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<CommunityVehicle | null> {
    const vehicle = await this.db
      .select(VEHICLE_COLUMNS)
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .then(firstRow);
    if (!vehicle) return null;
    const owner = await this.db
      .select(OWNER_COLUMNS)
      .from(userPreferences)
      .where(eq(userPreferences.userId, vehicle.userId))
      .then(firstRow);
    const owners = new Map([
      [vehicle.userId, owner ?? { userId: vehicle.userId, currency: 'USD', region: null }],
    ]);
    const [loaded] = await this.loadBatch([vehicle], owners, windowStart, windowEnd);
    return loaded ?? null;
  }

  async contribution(userId: string, scope: string): Promise<Contribution> {
    const row = await this.db
      .select({
        optIn: userPreferences.communityStatsOptIn,
        consentedAt: userPreferences.communityStatsConsentedAt,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .then(firstRow);
    if (row?.optIn !== true) return 'opted_out';
    const snapshot = await this.lastRefreshedAt(scope);
    const included =
      row.consentedAt !== null &&
      snapshot !== null &&
      row.consentedAt.getTime() < snapshot.getTime();
    return included ? 'included' : 'awaiting_refresh';
  }

  async publishedBuckets(
    scope: string,
    bucketKeys: string[],
    minGroup: number
  ): Promise<CommunityStat[]> {
    if (bucketKeys.length === 0) return [];
    return this.db
      .select()
      .from(communityStats)
      .where(
        and(
          eq(communityStats.scope, scope),
          inArray(communityStats.bucketKey, bucketKeys),
          gte(communityStats.nPublished, minGroup),
          eq(communityStats.schemaVersion, COMMUNITY_SCHEMA_VERSION)
        )
      );
  }

  private async loadBatch(
    batch: {
      id: string;
      userId: string;
      catalogModelId: string | null;
      year: number;
      vehicleType: string;
      vehicleKind: string;
      unitPreferences: unknown;
    }[],
    ownerById: Map<string, { currency: string; region: string | null }>,
    windowStart: Date,
    windowEnd: Date
  ): Promise<CommunityVehicle[]> {
    const ids = batch.map((vehicle) => vehicle.id);
    const [expenseRows, odometerRows, firstExpenses, firstReadings] = await Promise.all([
      this.db
        .select({
          vehicleId: expenses.vehicleId,
          date: expenses.date,
          category: expenses.category,
          expenseAmount: expenses.expenseAmount,
          mileage: expenses.mileage,
          volume: expenses.volume,
          fuelType: expenses.fuelType,
          missedFillup: expenses.missedFillup,
          sourceType: expenses.sourceType,
        })
        .from(expenses)
        .where(
          and(
            inArray(expenses.vehicleId, ids),
            inArray(expenses.category, ['fuel', 'maintenance']),
            gte(expenses.date, windowStart),
            lte(expenses.date, windowEnd)
          )
        ),
      this.db
        .select({
          vehicleId: odometerEntries.vehicleId,
          odometer: odometerEntries.odometer,
          recordedAt: odometerEntries.recordedAt,
        })
        .from(odometerEntries)
        .where(
          and(
            inArray(odometerEntries.vehicleId, ids),
            gte(odometerEntries.recordedAt, windowStart),
            lte(odometerEntries.recordedAt, windowEnd)
          )
        ),
      this.db
        .select({ vehicleId: expenses.vehicleId, first: min(expenses.date) })
        .from(expenses)
        .where(inArray(expenses.vehicleId, ids))
        .groupBy(expenses.vehicleId),
      this.db
        .select({ vehicleId: odometerEntries.vehicleId, first: min(odometerEntries.recordedAt) })
        .from(odometerEntries)
        .where(inArray(odometerEntries.vehicleId, ids))
        .groupBy(odometerEntries.vehicleId),
    ]);

    const expensesByVehicle = new Map<string, CommunityExpense[]>();
    for (const { vehicleId, ...expense } of expenseRows) {
      expensesByVehicle.set(vehicleId, [...(expensesByVehicle.get(vehicleId) ?? []), expense]);
    }
    const readingsByVehicle = new Map<string, { odometer: number; recordedAt: Date }[]>();
    for (const { vehicleId, ...reading } of odometerRows) {
      readingsByVehicle.set(vehicleId, [...(readingsByVehicle.get(vehicleId) ?? []), reading]);
    }
    const premiumsByVehicle = await this.premiumsByVehicle(ids, windowStart, windowEnd);
    const firstExpense = new Map(firstExpenses.map((row) => [row.vehicleId, row.first]));
    const firstReading = new Map(firstReadings.map((row) => [row.vehicleId, row.first]));

    return batch.flatMap((vehicle) => {
      const owner = ownerById.get(vehicle.userId);
      if (!owner) return [];
      const windowExpenses = expensesByVehicle.get(vehicle.id) ?? [];
      const readings = readingsByVehicle.get(vehicle.id) ?? [];
      return [
        {
          ownerId: vehicle.userId,
          vehicleId: vehicle.id,
          catalogModelId: vehicle.catalogModelId,
          modelYear: vehicle.year,
          vehicleType: vehicle.vehicleType,
          vehicleKind: vehicle.vehicleKind,
          unitPreferences:
            parseUnitPreferences(vehicle.unitPreferences) ?? DEFAULT_UNIT_PREFERENCES,
          currency: owner.currency,
          region: owner.region,
          firstRecordAt: pickTime(Math.min, [
            firstExpense.get(vehicle.id),
            firstReading.get(vehicle.id),
          ]),
          lastRecordAt: pickTime(Math.max, [
            ...windowExpenses.map((expense) => expense.date),
            ...readings.map((reading) => reading.recordedAt),
          ]),
          expenses: windowExpenses,
          odometerReadings: readings.map((reading) => reading.odometer),
          insurancePremiums: premiumsByVehicle.get(vehicle.id) ?? [],
        },
      ];
    });
  }

  private async premiumsByVehicle(
    ids: string[],
    windowStart: Date,
    windowEnd: Date
  ): Promise<Map<string, InsurancePremium[]>> {
    const rows = await this.db
      .select({
        vehicleId: expenses.vehicleId,
        amount: expenses.expenseAmount,
        termStart: insuranceTerms.startDate,
        termEnd: insuranceTerms.endDate,
      })
      .from(expenses)
      .innerJoin(insuranceTerms, eq(expenses.sourceId, insuranceTerms.id))
      .innerJoin(
        insurancePolicies,
        and(
          eq(insuranceTerms.policyId, insurancePolicies.id),
          eq(insurancePolicies.userId, expenses.userId)
        )
      )
      .where(
        and(
          inArray(expenses.vehicleId, ids),
          eq(expenses.sourceType, 'insurance_term'),
          lte(insuranceTerms.startDate, windowEnd),
          gte(insuranceTerms.endDate, windowStart)
        )
      );
    const byVehicle = new Map<string, InsurancePremium[]>();
    for (const { vehicleId, ...premium } of rows) {
      byVehicle.set(vehicleId, [...(byVehicle.get(vehicleId) ?? []), premium]);
    }
    return byVehicle;
  }

  async noiseKey(scope: string): Promise<string> {
    const fresh = randomBytes(32).toString('hex');
    await this.db
      .insert(communityNoiseKeys)
      .values({ scope, noiseKey: fresh })
      .onConflictDoNothing();
    const row = await this.db
      .select({ noiseKey: communityNoiseKeys.noiseKey })
      .from(communityNoiseKeys)
      .where(eq(communityNoiseKeys.scope, scope))
      .then(firstRow);
    return row?.noiseKey ?? fresh;
  }

  async lastRefreshedAt(scope: string): Promise<Date | null> {
    const row = await this.db
      .select({ refreshedAt: communityRefreshes.refreshedAt })
      .from(communityRefreshes)
      .where(eq(communityRefreshes.scope, scope))
      .then(firstRow);
    return row?.refreshedAt ?? null;
  }

  async releaseOutdated(scope: string): Promise<boolean> {
    const row = await this.db
      .select({ bucketKey: communityStats.bucketKey })
      .from(communityStats)
      .leftJoin(
        communityReleaseMembers,
        and(
          eq(communityReleaseMembers.scope, communityStats.scope),
          eq(communityReleaseMembers.bucketKey, communityStats.bucketKey)
        )
      )
      .where(
        and(
          eq(communityStats.scope, scope),
          or(
            isNull(communityReleaseMembers.memberTag),
            ne(communityStats.schemaVersion, COMMUNITY_SCHEMA_VERSION)
          )
        )
      )
      .limit(1)
      .then(firstRow);
    return row !== undefined;
  }

  async withdrawLeavers(scope: string, tagOf: (ownerId: string) => string): Promise<number> {
    const owners = await this.db
      .select({ userId: userPreferences.userId })
      .from(userPreferences)
      .where(eq(userPreferences.communityStatsOptIn, true));
    const current = new Set(owners.map((owner) => tagOf(owner.userId)));
    const members = await this.db
      .select({
        bucketKey: communityReleaseMembers.bucketKey,
        memberTag: communityReleaseMembers.memberTag,
      })
      .from(communityReleaseMembers)
      .where(eq(communityReleaseMembers.scope, scope));
    const left = [
      ...new Set(members.filter((m) => !current.has(m.memberTag)).map((m) => m.bucketKey)),
    ];
    if (left.length === 0) return 0;
    await this.db.transaction(async (tx) => {
      for (const keys of chunk(left)) {
        await tx
          .delete(communityStats)
          .where(and(eq(communityStats.scope, scope), inArray(communityStats.bucketKey, keys)));
        await tx
          .delete(communityReleaseMembers)
          .where(
            and(
              eq(communityReleaseMembers.scope, scope),
              inArray(communityReleaseMembers.bucketKey, keys)
            )
          );
      }
    });
    return left.length;
  }

  async replaceScope(
    scope: string,
    rows: NewCommunityStat[],
    members: { bucketKey: string; memberTag: string }[],
    refreshedAt: Date
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(communityStats).where(eq(communityStats.scope, scope));
      await tx.delete(communityReleaseMembers).where(eq(communityReleaseMembers.scope, scope));
      const perInsert = rowsPerInsert(Object.keys(getTableColumns(communityStats)).length);
      for (const batch of chunk(rows, perInsert)) {
        await tx.insert(communityStats).values(batch);
      }
      for (const batch of chunk(members, rowsPerInsert(3))) {
        await tx
          .insert(communityReleaseMembers)
          .values(batch.map((member) => ({ scope, ...member })));
      }
      await tx
        .insert(communityRefreshes)
        .values({ scope, refreshedAt })
        .onConflictDoUpdate({ target: communityRefreshes.scope, set: { refreshedAt } });
    });
  }
}
