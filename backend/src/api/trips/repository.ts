import { and, count, desc, eq, gte, lt, ne } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewTrip, Trip } from '../../db/schema';
import { trips } from '../../db/schema';
import { BaseRepository } from '../../utils/repository';
import { localDayWindow } from '../odometer/repository';

/** Distance is derived, never stored, so an odometer correction cannot desync it. Clamped at zero. */
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

  async findByIdAndUserId(id: string, userId: string): Promise<Trip | null> {
    const [row] = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Counts other trips sharing this vehicle, owner, end reading and local day. The odometer entry is
   * deduplicated on that key, so it must not be removed while another trip still maps to it.
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

  /** Newest first. Always scoped to userId, even when filtered by vehicle. */
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

  async findByVehicle(vehicleId: string, userId: string): Promise<Trip[]> {
    return this.db
      .select()
      .from(trips)
      .where(and(eq(trips.vehicleId, vehicleId), eq(trips.userId, userId)))
      .orderBy(desc(trips.tripDate));
  }

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

  async findIdsByVehicleId(vehicleId: string): Promise<string[]> {
    return this.findIdsByColumn(trips.vehicleId, vehicleId);
  }

  /** Deletes only when the row belongs to userId. False means nothing matched. */
  async deleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .returning();
    return deleted.length > 0;
  }
}

export const tripRepository = new TripRepository(getDb());
