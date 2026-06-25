/**
 * Odometer Repository
 *
 * Manual odometer entry CRUD and unified history via UNION query
 * combining expenses.mileage and odometer_entries.odometer.
 */

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

export class OdometerRepository extends BaseRepository<OdometerEntry, NewOdometerEntry> {
  constructor(db: AppDatabase) {
    super(db, odometerEntries);
  }

  /** IDs of all manual odometer entries for a vehicle (for cascade cleanup). */
  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(odometerEntries.vehicleId, vehicleId);
  }

  /**
   * Create an odometer entry derived from another signal (a trip's end reading — trips-location D2,
   * "reuse the odometer linkage"), DEDUPED by (vehicleId, calendar-day of recordedAt, odometer value):
   * if an entry already exists for the same vehicle + same local day + same reading, skip the insert and
   * return null (the user may have logged the reading manually too — D2 avoids the divergent double-count).
   * Returns the created entry on insert. userId-scoped on the dedup probe (the C109/#52 tenant discipline).
   * `note` defaults to a provenance marker so the unified history shows where the reading came from.
   */
  async createFromTrip(entry: {
    vehicleId: string;
    userId: string;
    odometer: number;
    recordedAt: Date;
    note?: string;
  }): Promise<OdometerEntry | null> {
    // Same-day window [startOfDay, nextDay) on the LOCAL calendar day of recordedAt (R5 local-day
    // semantics) — a trip and a manual reading on the same day at the same value are the same observation.
    const dayStart = new Date(
      entry.recordedAt.getFullYear(),
      entry.recordedAt.getMonth(),
      entry.recordedAt.getDate()
    );
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);

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
    if (existing.length > 0) return null; // dedup: same (vehicle, day, reading) already recorded

    return this.create({
      vehicleId: entry.vehicleId,
      userId: entry.userId,
      odometer: entry.odometer,
      recordedAt: entry.recordedAt,
      note: entry.note ?? 'From trip',
    });
  }

  /**
   * The tenant + vehicle scope shared by EVERY raw-SQL odometer-source leg: `vehicle_id = ?
   * AND user_id = ?`. The UNION-ALL history/current-odometer queries repeat this predicate once
   * per source leg (expenses + odometer_entries) AND once per query (data + count + max) — 6 sites.
   * Routing them all through ONE fragment keeps the #48/#52/C109 belt-and-braces tenant scope in
   * lockstep: a divergent copy that dropped `user_id` on a single leg would surface another user's
   * mileage into this user's history, or poison the maintenance mileage trigger (design D2) with a
   * cross-tenant reading. One source of truth means that can't drift in during a future edit.
   */
  private vehicleScope(vehicleId: string, userId: string): ReturnType<typeof sql> {
    return sql`vehicle_id = ${vehicleId} AND user_id = ${userId}`;
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
        FROM expenses WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL
        UNION ALL
        SELECT odometer, recorded_at, 'manual' AS source, id AS source_id, note
        FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)}
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      // Count query for pagination
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
