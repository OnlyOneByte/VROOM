import { and, asc, count, desc, eq, gt, gte, inArray, lt, ne, or, type SQL } from 'drizzle-orm';
import type { AsyncAppDatabase, AsyncHandle } from '../../db/async-sqlite';
import { sqlFalse } from '../../db/dialect';
import { firstRow } from '../../db/first-row';
import type { NewTrip, Trip } from '../../db/schema';
import { trips, vehicles } from '../../db/schema';
import { DEFAULT_UNIT_PREFERENCES, type DistanceUnit, parseUnitPreferences } from '../../types';
import { BaseRepository } from '../../utils/repository';
import { ownedVehiclesScope, type ReadableVehicle } from '../../utils/vehicle-access';
import { localDayWindow } from '../odometer/repository';

export function tripDistance(trip: Pick<Trip, 'startOdometer' | 'endOdometer'>): number {
  return Math.max(0, trip.endOdometer - trip.startOdometer);
}

function readableTripsScope(readable: readonly ReadableVehicle[]): SQL {
  if (readable.length === 0) return sqlFalse();
  return or(
    ...readable.map((v) => and(eq(trips.vehicleId, v.vehicleId), eq(trips.userId, v.ownerId)))
  ) as SQL;
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

  async findOverlapping(
    span: { vehicleId: string; userId: string; start: number; end: number; excludeTripId?: string },
    db: AsyncHandle = this.db
  ): Promise<Trip | null> {
    return db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.vehicleId, span.vehicleId),
          eq(trips.userId, span.userId),
          lt(trips.startOdometer, trips.endOdometer),
          lt(trips.startOdometer, span.end),
          gt(trips.endOdometer, span.start),
          span.excludeTripId ? ne(trips.id, span.excludeTripId) : undefined
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  // Odometer dedup key: do not remove the linked odometer entry while this returns > 0.
  async findOtherAtOdometerKey(
    args: {
      excludeTripId: string;
      vehicleId: string;
      userId: string;
      endOdometer: number;
      tripDate: Date;
      timeZone?: string;
    },
    db: AsyncHandle
  ): Promise<string | null> {
    const { dayStart, nextDay } = localDayWindow(args.tripDate, args.timeZone);
    const result = await db
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
      .then(firstRow);
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

  async findReadable(readable: readonly ReadableVehicle[]): Promise<Trip[]> {
    return this.db
      .select()
      .from(trips)
      .where(readableTripsScope(readable))
      .orderBy(desc(trips.tripDate));
  }

  async findReadablePaginated(
    readable: readonly ReadableVehicle[],
    limit: number,
    offset: number,
    purpose?: string
  ): Promise<{ data: Trip[]; totalCount: number }> {
    const where = and(
      readableTripsScope(readable),
      purpose ? eq(trips.purpose, purpose) : undefined
    );
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

  async findVehicleDistanceUnits(
    userId: string,
    vehicleIds?: readonly string[]
  ): Promise<Map<string, DistanceUnit>> {
    const rows = await this.db
      .select({ id: vehicles.id, unitPreferences: vehicles.unitPreferences })
      .from(vehicles)
      .where(
        vehicleIds
          ? vehicleIds.length
            ? inArray(vehicles.id, [...vehicleIds])
            : sqlFalse()
          : ownedVehiclesScope(userId)
      );
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
