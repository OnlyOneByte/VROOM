/**
 * Trip Repository (trips-location T2, design §2).
 *
 * Manual trip-log CRUD over the `trips` table. Mirrors OdometerRepository: a thin BaseRepository
 * subclass (inheriting findById/create/update/delete) plus userId-scoped finders. EVERY query ANDs
 * `eq(trips.userId, userId)` — the C155 tenant-scope discipline; the destructive delete keys on BOTH
 * id AND userId (the #52 lesson: an id-only delete lets one user delete another's row). `distance` is
 * NOT a column — it's derived `max(0, endOdometer − startOdometer)` at read time (R2, the #46 clamp),
 * so a later odometer correction can't desync a stored value; the helper is exported for the route/
 * analytics layers (T3/T5) to share one source of truth.
 */

import { and, count, desc, eq, gte, lt, ne } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewTrip, Trip } from '../../db/schema';
import { trips } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';
import { localDayWindow } from '../odometer/repository';

/** Derived trip distance: driven miles, clamped at 0 (R2, the #46 negative-guard). Never stored. */
export function tripDistance(trip: Pick<Trip, 'startOdometer' | 'endOdometer'>): number {
  return Math.max(0, trip.endOdometer - trip.startOdometer);
}

export interface TripFilters {
  vehicleId?: string;
  purpose?: string;
}

export class TripRepository extends BaseRepository<Trip, NewTrip> {
  constructor(db: AppDatabase) {
    super(db, trips);
  }

  /** A single trip scoped to its owner (the validateTripOwnership backing read). */
  async findByIdAndUserId(id: string, userId: string): Promise<Trip | null> {
    const [row] = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Count OTHER trips (excluding `excludeTripId`) that map to the SAME trip↔odometer dedup key — same
   * vehicle + owner + endOdometer + LOCAL calendar day of tripDate. The C214 lifecycle removes the linked
   * odometer entry on a keepOdometer=false delete (and the edit re-sync), but createFromTrip DEDUPS, so two
   * trips at the same (vehicle, day, reading) SHARE one entry (N:1). Removing it while another trip still
   * references it orphans that survivor's odometer reading (#C214-N1, found C10). The route uses this to
   * remove the shared entry ONLY when no other trip still maps to it. Uses the SAME localDayWindow as
   * createFromTrip/deleteLinkedTripEntry so "another trip on this day" agrees with the dedup's day. Tenant-scoped.
   */
  async countOthersAtOdometerKey(args: {
    excludeTripId: string;
    vehicleId: string;
    userId: string;
    endOdometer: number;
    tripDate: Date;
  }): Promise<number> {
    const { dayStart, nextDay } = localDayWindow(args.tripDate);
    const [result] = await this.db
      .select({ count: count() })
      .from(trips)
      .where(
        and(
          eq(trips.userId, args.userId),
          eq(trips.vehicleId, args.vehicleId),
          eq(trips.endOdometer, args.endOdometer),
          ne(trips.id, args.excludeTripId),
          gte(trips.tripDate, dayStart),
          lt(trips.tripDate, nextDay)
        )
      );
    return result?.count ?? 0;
  }

  /**
   * All of a user's trips, newest first, optionally narrowed by vehicle and/or purpose. userId is
   * ALWAYS in the predicate (tenant scope) — a vehicleId filter NEVER widens past the owner.
   */
  async findByUserId(userId: string, filters?: TripFilters): Promise<Trip[]> {
    const conditions = [eq(trips.userId, userId)];
    if (filters?.vehicleId) conditions.push(eq(trips.vehicleId, filters.vehicleId));
    if (filters?.purpose) conditions.push(eq(trips.purpose, filters.purpose));
    return this.db
      .select()
      .from(trips)
      .where(and(...conditions))
      .orderBy(desc(trips.tripDate));
  }

  /** A vehicle's trips (newest first), tenant-scoped — vehicle_id AND user_id together. */
  async findByVehicle(vehicleId: string, userId: string): Promise<Trip[]> {
    return this.db
      .select()
      .from(trips)
      .where(and(eq(trips.vehicleId, vehicleId), eq(trips.userId, userId)))
      .orderBy(desc(trips.tripDate));
  }

  /** Paginated trips for a user (the list route's read), with a total count for the paginator. */
  async findByUserIdPaginated(
    userId: string,
    limit: number,
    offset: number,
    filters?: TripFilters
  ): Promise<{ data: Trip[]; totalCount: number }> {
    const conditions = [eq(trips.userId, userId)];
    if (filters?.vehicleId) conditions.push(eq(trips.vehicleId, filters.vehicleId));
    if (filters?.purpose) conditions.push(eq(trips.purpose, filters.purpose));
    const where = and(...conditions);

    const data = await this.db
      .select()
      .from(trips)
      .where(where)
      .orderBy(desc(trips.tripDate))
      .limit(limit)
      .offset(offset);

    const [result] = await this.db.select({ count: count() }).from(trips).where(where);
    return { data, totalCount: result?.count ?? 0 };
  }

  /** IDs of all trips for a vehicle (for the vehicle-delete cascade / photo cleanup parity). */
  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(trips.vehicleId, vehicleId);
  }

  /**
   * Delete a trip scoped to its owner: the WHERE keys on BOTH id AND userId (the #52 lesson — an
   * id-only delete would let a crafted request remove another user's trip). Returns true when a row
   * was actually deleted, false when nothing matched (caller maps false → 404). Distinct from the
   * BaseRepository `delete(id)` which keys on id alone (correct only after an ownership pre-check).
   */
  async deleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .returning();
    return deleted.length > 0;
  }
}

export const tripRepository = new TripRepository(getDb());
