import { and, asc, count, desc, eq, gte, lt, ne } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import type { AppDatabase } from '../../db/connection';
import type { NewTrip, Trip } from '../../db/schema';
import { trips, vehicles } from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';
import { DEFAULT_UNIT_PREFERENCES, type DistanceUnit, parseUnitPreferences } from '../../types';
import { BaseRepository } from '../../utils/repository';
import { ownedVehiclesScope } from '../../utils/vehicle-access';
import { localDayWindow } from '../odometer/repository';

export function tripDistance(trip: Pick<Trip, 'startOdometer' | 'endOdometer'>): number {
  return Math.max(0, trip.endOdometer - trip.startOdometer);
}

interface TripFilters {
  vehicleId?: string;
  purpose?: string;
}

export class TripRepository extends BaseRepository<Trip, NewTrip> {
  constructor(db: AsyncAppDatabase) {
    super(db, trips);
  }

  async findById(id: string): Promise<Trip | null> {
    const [row] = await this.db.select().from(trips).where(eq(trips.id, id)).limit(1);
    return row ?? null;
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Trip | null> {
    const [row] = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  // Odometer dedup key: do not remove the linked odometer entry while this returns > 0.
  findOtherAtOdometerKey(
    args: {
      excludeTripId: string;
      vehicleId: string;
      userId: string;
      endOdometer: number;
      tripDate: Date;
      timeZone?: string;
    },
    db: AppDatabase | DrizzleTransaction
  ): string | null {
    const { dayStart, nextDay } = localDayWindow(args.tripDate, args.timeZone);
    const result = db
      .select({ id: trips.id })
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
      )
      .orderBy(asc(trips.createdAt), asc(trips.id))
      .get();
    return result?.id ?? null;
  }

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

  async findVehicleDistanceUnits(userId: string): Promise<Map<string, DistanceUnit>> {
    const rows = await this.db
      .select({ id: vehicles.id, unitPreferences: vehicles.unitPreferences })
      .from(vehicles)
      .where(ownedVehiclesScope(userId));
    return new Map(
      rows.map((row) => [
        row.id,
        (parseUnitPreferences(row.unitPreferences) ?? DEFAULT_UNIT_PREFERENCES).distanceUnit,
      ])
    );
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
}
