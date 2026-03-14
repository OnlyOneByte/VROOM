/**
 * Odometer Repository
 *
 * Manual odometer entry CRUD and unified history via UNION query
 * combining expenses.mileage and odometer_entries.odometer.
 */

import { count, desc, eq, sql } from 'drizzle-orm';
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

  async findByVehicleIdPaginated(
    vehicleId: string,
    limit: number,
    offset: number
  ): Promise<{ data: OdometerEntry[]; totalCount: number }> {
    const data = await this.db
      .select()
      .from(odometerEntries)
      .where(eq(odometerEntries.vehicleId, vehicleId))
      .orderBy(desc(odometerEntries.recordedAt))
      .limit(limit)
      .offset(offset);

    const [result] = await this.db
      .select({ count: count() })
      .from(odometerEntries)
      .where(eq(odometerEntries.vehicleId, vehicleId));

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
    options?: { limit?: number; offset?: number }
  ): Promise<OdometerHistoryResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    try {
      // Data query: UNION ALL combining expenses.mileage and odometer_entries
      const rows = await this.db.all<{
        odometer: number;
        recorded_at: number;
        source: string;
        source_id: string;
        note: string | null;
      }>(sql`
        SELECT mileage AS odometer, date AS recorded_at, 'expense' AS source, id AS source_id, NULL AS note
        FROM expenses WHERE vehicle_id = ${vehicleId} AND mileage IS NOT NULL
        UNION ALL
        SELECT odometer, recorded_at, 'manual' AS source, id AS source_id, note
        FROM odometer_entries WHERE vehicle_id = ${vehicleId}
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      // Count query for pagination
      const [countResult] = await this.db.all<{ total: number }>(sql`
        SELECT (
          (SELECT COUNT(*) FROM expenses WHERE vehicle_id = ${vehicleId} AND mileage IS NOT NULL) +
          (SELECT COUNT(*) FROM odometer_entries WHERE vehicle_id = ${vehicleId})
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
}

export const odometerRepository = new OdometerRepository(getDb());
