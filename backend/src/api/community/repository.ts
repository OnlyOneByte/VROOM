import { and, desc, eq, getTableColumns, gte, inArray, lte, min, or } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import {
  type CommunityStat,
  communityStats,
  expenses,
  type NewCommunityStat,
  odometerEntries,
  userPreferences,
  vehicles,
} from '../../db/schema';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences } from '../../types';
import { chunk, rowsPerInsert } from '../../utils/chunk';
import type { CommunityExpense, CommunityVehicle } from './aggregator';

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
  unitPreferences: vehicles.unitPreferences,
};

export type Contribution = 'opted_out' | 'awaiting_refresh' | 'included';

export class CommunityStatsRepository {
  constructor(private db: AppDatabase) {}

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
      .get();
    if (!vehicle) return null;
    const owner = await this.db
      .select(OWNER_COLUMNS)
      .from(userPreferences)
      .where(eq(userPreferences.userId, vehicle.userId))
      .get();
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
      .get();
    if (row?.optIn !== true) return 'opted_out';
    const snapshot = await this.newestComputedAt(scope);
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
          gte(communityStats.nPublished, minGroup)
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
            or(
              inArray(expenses.category, ['fuel', 'maintenance']),
              eq(expenses.sourceType, 'insurance_term')
            ),
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
        },
      ];
    });
  }

  async newestComputedAt(scope: string): Promise<Date | null> {
    const row = await this.db
      .select({ computedAt: communityStats.computedAt })
      .from(communityStats)
      .where(eq(communityStats.scope, scope))
      .orderBy(desc(communityStats.computedAt))
      .limit(1)
      .get();
    return row?.computedAt ?? null;
  }

  replaceScope(scope: string, rows: NewCommunityStat[]): void {
    this.db.transaction((tx) => {
      tx.delete(communityStats).where(eq(communityStats.scope, scope)).run();
      const perInsert = rowsPerInsert(Object.keys(getTableColumns(communityStats)).length);
      for (const batch of chunk(rows, perInsert)) {
        tx.insert(communityStats).values(batch).run();
      }
    });
  }
}

export const communityStatsRepository = new CommunityStatsRepository(getDb());
