import { and, desc, eq, getTableColumns, gte, inArray, lte, min } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import {
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

function earliest(...dates: (Date | null | undefined)[]): Date | null {
  const times = dates.flatMap((date) => (date ? [date.getTime()] : []));
  return times.length > 0 ? new Date(Math.min(...times)) : null;
}

export class CommunityStatsRepository {
  constructor(private db: AppDatabase) {}

  async loadOptedIn(windowStart: Date, windowEnd: Date): Promise<CommunityInput> {
    const owners = await this.db
      .select({
        userId: userPreferences.userId,
        currency: userPreferences.currencyUnit,
        region: userPreferences.communityRegion,
      })
      .from(userPreferences)
      .where(eq(userPreferences.communityStatsOptIn, true));
    const ownerById = new Map(owners.map((owner) => [owner.userId, owner]));

    const result: CommunityVehicle[] = [];
    for (const ownerIds of chunk([...ownerById.keys()])) {
      const ownedVehicles = await this.db
        .select({
          id: vehicles.id,
          userId: vehicles.userId,
          catalogModelId: vehicles.catalogModelId,
          year: vehicles.year,
          vehicleType: vehicles.vehicleType,
          unitPreferences: vehicles.unitPreferences,
        })
        .from(vehicles)
        .where(inArray(vehicles.userId, ownerIds));
      for (const batch of chunk(ownedVehicles)) {
        result.push(...(await this.loadBatch(batch, ownerById, windowStart, windowEnd)));
      }
    }
    return { optedInOwners: owners.length, vehicles: result };
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
            gte(expenses.date, windowStart),
            lte(expenses.date, windowEnd)
          )
        ),
      this.db
        .select({ vehicleId: odometerEntries.vehicleId, odometer: odometerEntries.odometer })
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
    const readingsByVehicle = new Map<string, number[]>();
    for (const { vehicleId, odometer } of odometerRows) {
      readingsByVehicle.set(vehicleId, [...(readingsByVehicle.get(vehicleId) ?? []), odometer]);
    }
    const firstExpense = new Map(firstExpenses.map((row) => [row.vehicleId, row.first]));
    const firstReading = new Map(firstReadings.map((row) => [row.vehicleId, row.first]));

    return batch.flatMap((vehicle) => {
      const owner = ownerById.get(vehicle.userId);
      if (!owner) return [];
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
          firstRecordAt: earliest(firstExpense.get(vehicle.id), firstReading.get(vehicle.id)),
          expenses: expensesByVehicle.get(vehicle.id) ?? [],
          odometerReadings: readingsByVehicle.get(vehicle.id) ?? [],
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
