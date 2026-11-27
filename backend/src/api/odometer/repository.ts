import { and, count, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { repos } from '../../app-context';
import type { AsyncAppDatabase, AsyncHandle } from '../../db/async-sqlite';
import { rawAll, sqlFalse } from '../../db/dialect';
import { firstRow } from '../../db/first-row';
import type { NewOdometerEntry, OdometerEntry } from '../../db/schema';
import { odometerEntries } from '../../db/schema';
import { DatabaseError, NotFoundError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';
import { zonedDayWindow } from '../../utils/time-zone';
import { hiddenFinancialsScope } from '../../utils/vehicle-access';
import type { OdometerCheck } from '../expenses/validation';

interface OdometerHistoryEntry {
  odometer: number;
  recordedAt: Date;
  source: 'expense' | 'manual';
  sourceId: string;
  note: string | null;
}

interface OdometerHistoryResult {
  data: OdometerHistoryEntry[];
  totalCount: number;
}

interface LinkedTripEntryKey {
  tripId: string;
  vehicleId: string;
  userId: string;
  odometer: number;
  recordedAt: Date;
  timeZone?: string;
}

// Shared with trips: changing this window breaks trip/odometer dedup.
export function localDayWindow(
  recordedAt: Date,
  timeZone?: string
): { dayStart: Date; nextDay: Date } {
  if (timeZone) return zonedDayWindow(recordedAt, timeZone);
  const dayStart = new Date(recordedAt.getFullYear(), recordedAt.getMonth(), recordedAt.getDate());
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);
  return { dayStart, nextDay };
}

export async function readingCheck(
  vehicleId: string,
  odometer: number,
  recordedAt: Date,
  timeZone: string | undefined,
  excludeId?: string
): Promise<OdometerCheck> {
  const vehicle = await repos().vehicles.findById(vehicleId);
  return {
    vehicleId,
    mileage: odometer,
    date: recordedAt,
    timeZone: timeZone ?? 'UTC',
    excludeId,
    initialMileage: vehicle?.initialMileage,
  };
}

export class OdometerRepository extends BaseRepository<OdometerEntry, NewOdometerEntry> {
  constructor(db: AsyncAppDatabase) {
    super(db, odometerEntries);
  }

  async createChecked(
    data: NewOdometerEntry,
    check: (tx: AsyncHandle) => Promise<void>
  ): Promise<OdometerEntry> {
    return this.db.transaction(async (tx) => {
      await check(tx);
      const [created] = await tx.insert(odometerEntries).values(data).returning();
      if (!created) throw new Error('Odometer insert returned no row');
      return created;
    });
  }

  async updateChecked(
    id: string,
    data: Partial<NewOdometerEntry>,
    check: (tx: AsyncHandle) => Promise<void>
  ): Promise<OdometerEntry> {
    return this.db.transaction(async (tx) => {
      await check(tx);
      const [updated] = await tx
        .update(odometerEntries)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(odometerEntries.id, id))
        .returning();
      if (!updated) throw new NotFoundError('Odometer entry');
      return updated;
    });
  }

  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(odometerEntries.vehicleId, vehicleId);
  }

  async createFromTrip(
    entry: {
      tripId: string;
      vehicleId: string;
      userId: string;
      odometer: number;
      recordedAt: Date;
      note?: string;
      timeZone?: string;
      createdBy?: string | null;
      driverId?: string | null;
    },
    db: AsyncHandle = this.db
  ): Promise<OdometerEntry | null> {
    const sameReading = this.sameReadingWhere(entry);
    const existing = await db
      .select({ id: odometerEntries.id })
      .from(odometerEntries)
      .where(sameReading)
      .then(firstRow);
    if (existing) {
      await db
        .update(odometerEntries)
        .set({ sourceTripId: entry.tripId })
        .where(
          and(
            sameReading,
            isNotNull(odometerEntries.sourceTripId),
            sql`NOT EXISTS (SELECT 1 FROM trips WHERE trips.id = ${odometerEntries.sourceTripId})`
          )
        );
      return null;
    }

    const [created] = await db
      .insert(odometerEntries)
      .values({
        vehicleId: entry.vehicleId,
        userId: entry.userId,
        createdBy: entry.createdBy ?? null,
        driverId: entry.driverId ?? null,
        odometer: entry.odometer,
        recordedAt: entry.recordedAt,
        note: entry.note ?? OdometerRepository.TRIP_PROVENANCE_NOTE,
        sourceTripId: entry.tripId,
      })
      .returning();
    return created ?? null;
  }

  static readonly TRIP_PROVENANCE_NOTE = 'From trip';

  async deleteLinkedTripEntry(
    entry: LinkedTripEntryKey,
    db: AsyncHandle = this.db
  ): Promise<string[]> {
    const removed = await db
      .delete(odometerEntries)
      .where(this.linkedTripEntryWhere(entry))
      .returning({ id: odometerEntries.id });
    return removed.map((row) => row.id);
  }

  async moveLinkedTripEntry(
    from: LinkedTripEntryKey,
    to: { odometer: number; recordedAt: Date },
    db: AsyncHandle = this.db
  ): Promise<string | null> {
    const linked = await db
      .select({ id: odometerEntries.id })
      .from(odometerEntries)
      .where(this.linkedTripEntryWhere(from));
    const [only] = linked;
    if (!only || linked.length !== 1) return null;
    const target = await db
      .select({ id: odometerEntries.id })
      .from(odometerEntries)
      .where(and(this.sameReadingWhere({ ...from, ...to }), ne(odometerEntries.id, only.id)))
      .then(firstRow);
    if (target) return null;
    await db
      .update(odometerEntries)
      .set({
        odometer: to.odometer,
        recordedAt: to.recordedAt,
        sourceTripId: from.tripId,
        updatedAt: new Date(),
      })
      .where(eq(odometerEntries.id, only.id));
    return only.id;
  }

  async handOverLinkedTripEntry(
    entry: LinkedTripEntryKey,
    toTripId: string,
    db: AsyncHandle = this.db
  ): Promise<void> {
    await db
      .update(odometerEntries)
      .set({ sourceTripId: toTripId })
      .where(this.linkedTripEntryWhere(entry));
  }

  private sameReadingWhere(entry: LinkedTripEntryKey) {
    const { dayStart, nextDay } = localDayWindow(entry.recordedAt, entry.timeZone);
    return and(
      eq(odometerEntries.vehicleId, entry.vehicleId),
      eq(odometerEntries.userId, entry.userId),
      eq(odometerEntries.odometer, entry.odometer),
      gte(odometerEntries.recordedAt, dayStart),
      lt(odometerEntries.recordedAt, nextDay)
    );
  }

  private linkedTripEntryWhere(entry: LinkedTripEntryKey) {
    const { dayStart, nextDay } = localDayWindow(entry.recordedAt, entry.timeZone);
    return and(
      eq(odometerEntries.vehicleId, entry.vehicleId),
      eq(odometerEntries.userId, entry.userId),
      or(
        eq(odometerEntries.sourceTripId, entry.tripId),
        and(
          isNull(odometerEntries.sourceTripId),
          eq(odometerEntries.odometer, entry.odometer),
          eq(odometerEntries.note, OdometerRepository.TRIP_PROVENANCE_NOTE),
          gte(odometerEntries.recordedAt, dayStart),
          lt(odometerEntries.recordedAt, nextDay)
        )
      )
    );
  }

  // Every raw-SQL leg must keep the user_id predicate or rows leak across users.
  private vehicleScope(vehicleId: string, userId: string): ReturnType<typeof sql> {
    return sql`vehicle_id = ${vehicleId} AND user_id = ${userId}`;
  }

  async findByVehicleIdPaginated(
    vehicleId: string,
    userId: string,
    limit: number,
    offset: number
  ): Promise<{ data: OdometerEntry[]; totalCount: number }> {
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
    options?: {
      limit?: number;
      offset?: number;
      hideFinancials?: boolean;
      includeExpenses?: boolean;
    }
  ): Promise<OdometerHistoryResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const financials = options?.hideFinancials ? sql`AND ${hiddenFinancialsScope()}` : sql``;
    const visibleExpenses =
      options?.includeExpenses === false ? sql`AND ${sqlFalse()}` : financials;

    try {
      const rows = await rawAll<{
        odometer: number;
        recorded_at: number;
        source: string;
        source_id: string;
        note: string | null;
      }>(
        this.db,
        sql`
        SELECT mileage AS odometer, date AS recorded_at, 'expense' AS source, id AS source_id, NULL AS note
        FROM expenses WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL ${visibleExpenses}
        UNION ALL
        SELECT odometer, recorded_at, 'manual' AS source, id AS source_id, note
        FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)}
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      );

      const [countResult] = await rawAll<{ total: number }>(
        this.db,
        sql`
        SELECT (
          (SELECT COUNT(*) FROM expenses WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL ${visibleExpenses}) +
          (SELECT COUNT(*) FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)})
        ) AS total
      `
      );

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

  async getCurrentOdometer(vehicleId: string, userId: string): Promise<number | null> {
    try {
      const [row] = await rawAll<{ current: number | null }>(
        this.db,
        sql`
        SELECT MAX(odometer) AS current FROM (
          SELECT mileage AS odometer FROM expenses
            WHERE ${this.vehicleScope(vehicleId, userId)} AND mileage IS NOT NULL
          UNION ALL
          SELECT odometer FROM odometer_entries WHERE ${this.vehicleScope(vehicleId, userId)}
        ) AS readings
      `
      );

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
