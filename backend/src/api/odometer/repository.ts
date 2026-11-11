import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
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

/**
 * Half-open `[dayStart, nextDay)` window on the local calendar day of `recordedAt`. The trip↔odometer
 * dedup key depends on it: create, delete, and the trips repo must all compute the same window.
 */
export function localDayWindow(recordedAt: Date): { dayStart: Date; nextDay: Date } {
  const dayStart = new Date(recordedAt.getFullYear(), recordedAt.getMonth(), recordedAt.getDate());
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);
  return { dayStart, nextDay };
}

export class OdometerRepository extends BaseRepository<OdometerEntry, NewOdometerEntry> {
  constructor(db: AppDatabase) {
    super(db, odometerEntries);
  }

  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(odometerEntries.vehicleId, vehicleId);
  }

  /**
   * Records a trip's end reading unless a same-day, same-value entry already exists, so a manual reading
   * and a trip reading for the same observation are not double-counted. Returns null when deduped.
   */
  async createFromTrip(entry: {
    vehicleId: string;
    userId: string;
    odometer: number;
    recordedAt: Date;
    note?: string;
  }): Promise<OdometerEntry | null> {
    const { dayStart, nextDay } = localDayWindow(entry.recordedAt);

    const existing = await this.db
      .select({ id: odometerEntries.id })
      .from(odometerEntries)
      .where(
        and(
          eq(odometerEntries.vehicleId, entry.vehicleId),
          eq(odometerEntries.userId, entry.userId),
          eq(odometerEntries.odometer, entry.odometer),
          gte(odometerEntries.recordedAt, dayStart),
          lt(odometerEntries.recordedAt, nextDay)
        )
      )
      .limit(1);
    if (existing.length > 0) return null;

    return this.create({
      vehicleId: entry.vehicleId,
      userId: entry.userId,
      odometer: entry.odometer,
      recordedAt: entry.recordedAt,
      note: entry.note ?? OdometerRepository.TRIP_PROVENANCE_NOTE,
    });
  }

  /** Marks trip-created entries so lifecycle deletes never touch manual readings. */
  static readonly TRIP_PROVENANCE_NOTE = 'From trip';

  /**
   * Deletes only the trip-created entry matching the createFromTrip key. Manual readings at the same key
   * lack the provenance note and are kept. Returns the number of rows removed.
   */
  async deleteLinkedTripEntry(entry: {
    vehicleId: string;
    userId: string;
    odometer: number;
    recordedAt: Date;
  }): Promise<number> {
    const { dayStart, nextDay } = localDayWindow(entry.recordedAt);

    const removed = await this.db
      .delete(odometerEntries)
      .where(
        and(
          eq(odometerEntries.vehicleId, entry.vehicleId),
          eq(odometerEntries.userId, entry.userId),
          eq(odometerEntries.odometer, entry.odometer),
          eq(odometerEntries.note, OdometerRepository.TRIP_PROVENANCE_NOTE),
          gte(odometerEntries.recordedAt, dayStart),
          lt(odometerEntries.recordedAt, nextDay)
        )
      )
      .returning();
    return removed.length;
  }

  /** Tenant and vehicle predicate applied to every raw-SQL source leg. Each leg must keep user_id. */
  private vehicleScope(vehicleId: string, userId: string): ReturnType<typeof sql> {
    return sql`vehicle_id = ${vehicleId} AND user_id = ${userId}`;
  }

  async findByVehicleIdPaginated(
    vehicleId: string,
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ data: OdometerEntry[]; totalCount: number }> {
    // Scoped by user_id so an unvalidated vehicleId cannot leak another user's rows.
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

  async getHistory(
    vehicleId: string,
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<OdometerHistoryResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    try {
      const rows = await this.db.all<{
        odometer: number;
        recorded_at: number;
        source: string;
        source_id: string;
        note: string | null;
      }>(sql`
        SELECT mileage AS odometer, date AS recorded_at, 'expense' AS source, id AS source_id, NULL AS note
        FROM expenses WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL
        UNION ALL
        SELECT odometer, recorded_at, 'manual' AS source, id AS source_id, note
        FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)}
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const [countResult] = await this.db.all<{ total: number }>(sql`
        SELECT (
          (SELECT COUNT(*) FROM expenses WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL) +
          (SELECT COUNT(*) FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)})
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
   * Highest reading by value across expense mileage and manual entries, or null when there are none.
   * Feeds the maintenance mileage trigger. Readings are stored in the vehicle's distanceUnit as entered.
   */
  async getCurrentOdometer(vehicleId: string, userId: string): Promise<number | null> {
    try {
      const [row] = await this.db.all<{ current: number | null }>(sql`
        SELECT MAX(odometer) AS current FROM (
          SELECT mileage AS odometer FROM expenses
            WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL
          UNION ALL
          SELECT odometer FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)}
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
