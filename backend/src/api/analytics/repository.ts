import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import { expenses, vehicles } from '../../db/schema';
import { isElectricFuelType } from '../../db/types';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';

/** Efficiency filter constants — must match frontend expense-helpers.ts */
const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;
const MIN_VALID_MPG = 5;
const MAX_VALID_MPG = 100;
const MIN_VALID_MI_KWH = 1;
const MAX_VALID_MI_KWH = 10;

export interface FuelEfficiencyPoint {
  date: string;
  efficiency: number;
  mileage: number;
}

interface FuelRow {
  date: Date | null;
  mileage: number | null;
  fuelAmount: number | null;
  fuelType: string | null;
  missedFillup: boolean;
}

/** Check if an efficiency value is within realistic bounds for the fuel type. */
function isRealisticEfficiency(efficiency: number, electric: boolean): boolean {
  if (electric) {
    return efficiency >= MIN_VALID_MI_KWH && efficiency <= MAX_VALID_MI_KWH;
  }
  return efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
}

/** Try to compute an efficiency point from a consecutive pair. Returns null if invalid. */
function computeEfficiencyPoint(current: FuelRow, previous: FuelRow): FuelEfficiencyPoint | null {
  if (current.missedFillup || previous.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;

  const milesDriven = current.mileage - previous.mileage;
  if (milesDriven <= 0 || milesDriven > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;
  if (!current.fuelAmount || current.fuelAmount <= 0) return null;

  const efficiency = milesDriven / current.fuelAmount;
  if (!isRealisticEfficiency(efficiency, isElectricFuelType(current.fuelType))) return null;

  return {
    date: current.date instanceof Date ? current.date.toISOString() : String(current.date),
    efficiency,
    mileage: current.mileage,
  };
}

export class AnalyticsRepository {
  constructor(private db: BunSQLiteDatabase<Record<string, unknown>>) {}

  /**
   * Compute fuel efficiency trend from sequential fuel expenses.
   * Replicates the frontend `prepareFuelEfficiencyData` algorithm server-side.
   *
   * - Queries fuel expenses with mileage, joined with vehicles for ownership
   * - Orders by date ASC for sequential pair processing
   * - Skips missed fillups and filters unrealistic values
   * - Returns all-time data (no period filtering)
   */
  async getFuelEfficiencyTrend(userId: string, vehicleId?: string): Promise<FuelEfficiencyPoint[]> {
    try {
      const conditions = [
        eq(vehicles.userId, userId),
        eq(expenses.category, 'fuel'),
        isNotNull(expenses.mileage),
        isNotNull(expenses.fuelAmount),
      ];

      if (vehicleId) {
        conditions.push(eq(expenses.vehicleId, vehicleId));
      }

      const rows = await this.db
        .select({
          date: expenses.date,
          mileage: expenses.mileage,
          fuelAmount: expenses.fuelAmount,
          fuelType: expenses.fuelType,
          missedFillup: expenses.missedFillup,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.date));

      if (rows.length < 2) {
        return [];
      }

      const points: FuelEfficiencyPoint[] = [];
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) continue;

        const point = computeEfficiencyPoint(current, previous);
        if (point) points.push(point);
      }

      return points;
    } catch (error) {
      logger.error('Failed to compute fuel efficiency trend', {
        userId,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute fuel efficiency trend', error);
    }
  }
}

// Export singleton instance
export const analyticsRepository = new AnalyticsRepository(getDb());
