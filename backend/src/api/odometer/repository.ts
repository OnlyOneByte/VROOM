/**
 * Odometer Repository
 *
 * Manual odometer entry CRUD and unified history via UNION query
 * combining expenses.mileage and odometer_entries.odometer.
 */

import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewOdometerEntry, OdometerEntry } from '../../db/schema';
import { odometerEntries } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

export interface OdometerHistoryEntry {
  odometer: number;
  recordedAt: Date;
  source: 'expense' | 'manual';
  sourceId: string;
  note: string | null;
}

export interface OdometerHistoryResult {
  data: OdometerHistoryEntry[];
  totalCount: number;
}

export class OdometerRepository extends BaseRepository<OdometerEntry, NewOdometerEntry> {
  constructor(db: AppDatabase) {
    super(db, odometerEntries);
  }

  /** IDs of all manual odometer entries for a vehicle (for cascade cleanup). */
  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: odometerEntries.id })
      .from(odometerEntries)
      .where(eq(odometerEntries.vehicleId, vehicleId));
    return rows.map((r) => r.id);
  }

  async findByVehicleIdPaginated(
    vehicleId: string,
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ data: OdometerEntry[]; totalCount: number }> {
    // userId-scope BOTH legs (#48 — completes the C168 sweep, which scoped getHistory +
    // getCurrentOdometer but missed THIS method): the route validates vehicle ownership
    // first, but scoping here means an unvalidated vehicleId can never surface another
    // user's manual entries (the C109/#52 tenant class). vehicle_id AND user_id together.
    const where = and(eq(odometerEntries.vehicleId, vehicleId), eq(odometerEntries.userId, userId));

    const data = await this.db
      .select()
      .from(odometerEntries)
      .where(where)
      .orderBy(desc(odometerEntries.recordedAt))
      .limit(limit)
      .offset(offset);

    const [result] = await this.db.select({ count: count() }).from(odometerEntries).where(where);

    return { data, totalCount: result?.count ?? 0 };
  }

  /**
   * Get unified odometer history combining expense mileage and manual entries.
   *
   * Executes a UNION ALL query:
   * - expenses WHERE mileage IS NOT NULL → source='expense'
   * - odometer_entries → source='manual'
   * Ordered by date DESC with LIMIT/OFFSET pagination.
   */
  async getHistory(
    vehicleId: string,
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<OdometerHistoryResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    try {
      // Data query: UNION ALL combining expenses.mileage and odometer_entries. Both legs AND the userId
      // scope (#48 belt-and-braces): callers validate vehicle ownership first, but scoping here too means
      // an unvalidated vehicleId can never surface another user's readings (the C109/#52 tenant class).
      const rows = await this.db.all<{
        odometer: number;
        recorded_at: number;
        source: string;
        source_id: string;
        note: string | null;
      }>(sql`
        SELECT mileage AS odometer, date AS recorded_at, 'expense' AS source, id AS source_id, NULL AS note
        FROM expenses WHERE vehicle_id = ${vehicleId} AND user_id = ${userId} AND mileage IS NOT NULL
        UNION ALL
        SELECT odometer, recorded_at, 'manual' AS source, id AS source_id, note
        FROM odometer_entries WHERE vehicle_id = ${vehicleId} AND user_id = ${userId}
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      // Count query for pagination
      const [countResult] = await this.db.all<{ total: number }>(sql`
        SELECT (
          (SELECT COUNT(*) FROM expenses WHERE vehicle_id = ${vehicleId} AND user_id = ${userId} AND mileage IS NOT NULL) +
          (SELECT COUNT(*) FROM odometer_entries WHERE vehicle_id = ${vehicleId} AND user_id = ${userId})
        ) AS total
      `);

      const totalCount = countResult?.total ?? 0;

      const data: OdometerHistoryEntry[] = rows.map((row) => ({
        odometer: Number(row.odometer),
        recordedAt: new Date(Number(row.recorded_at) * 1000),
        source: row.source as 'expense' | 'manual',
        sourceId: row.source_id,
        note: row.note,
      }));

      return { data, totalCount };
    } catch (error) {
      logger.error('Failed to get odometer history', {
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to get odometer history', error);
    }
  }

  /**
   * Current odometer reading for a vehicle = MAX across both sources
   * (`expenses.mileage` + `odometer_entries.odometer`), by value — not by date.
   *
   * This is the canonical "current odometer" for the maintenance-schedule
   * mileage trigger (design D2). It reconciles the fuel-only
   * `vehicle-stats.currentMileage` (which ignores manual entries and non-fuel
   * mileage) by considering every reading the vehicle has.
   *
   * Returns null when the vehicle has no readings on either source.
   * Distance is stored as-entered in the vehicle's distanceUnit (convert-on-read).
   */
  async getCurrentOdometer(vehicleId: string, userId: string): Promise<number | null> {
    try {
      // Both legs AND the userId scope (#48 belt-and-braces — see getHistory): scoping here means an
      // unvalidated vehicleId can never poison the mileage trigger with another user's reading.
      const [row] = await this.db.all<{ current: number | null }>(sql`
        SELECT MAX(odometer) AS current FROM (
          SELECT mileage AS odometer FROM expenses
            WHERE vehicle_id = ${vehicleId} AND user_id = ${userId} AND mileage IS NOT NULL
          UNION ALL
          SELECT odometer FROM odometer_entries WHERE vehicle_id = ${vehicleId} AND user_id = ${userId}
        )
      `);

      return row?.current == null ? null : Number(row.current);
    } catch (error) {
      logger.error('Failed to get current odometer', {
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to get current odometer', error);
    }
  }
}

export const odometerRepository = new OdometerRepository(getDb());
