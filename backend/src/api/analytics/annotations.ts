import { type SQL, sql } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import { rawAll } from '../../db/dialect';
import type { UnitPreferences } from '../../types';
import { convertDistance } from '../../utils/unit-conversions';

export const QUERY_ANNOTATIONS = ['services', 'trips'] as const;
export type QueryAnnotation = (typeof QUERY_ANNOTATIONS)[number];

export const MAX_SERVICES = 500;

export interface ServiceAnnotation {
  t: number;
  kind: 'service';
  vehicleId: string;
  vehicleName: string;
  label: string;
  amount: number;
}

export interface TripLane {
  count: number[];
  distance: number[];
}

interface Scope {
  userId: string;
  vehicleIds: string[];
  names: Map<string, string>;
  start: number;
  end: number;
}

function inList(values: readonly string[]): SQL {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  );
}

export async function serviceAnnotations(
  db: AsyncAppDatabase,
  scope: Scope
): Promise<{ services: ServiceAnnotation[]; truncated: boolean }> {
  if (scope.vehicleIds.length === 0) return { services: [], truncated: false };
  const rows = await rawAll<{
    date: number;
    vehicle_id: string;
    description: string | null;
    amount: number;
  }>(
    db,
    sql`
    SELECT e.date, e.vehicle_id, e.description, e.expense_amount AS amount FROM expenses e
    WHERE e.user_id = ${scope.userId} AND e.category = 'maintenance'
      AND e.vehicle_id IN (${inList(scope.vehicleIds)})
      AND e.date >= ${scope.start} AND e.date < ${scope.end}
    ORDER BY e.date DESC, e.id DESC LIMIT ${MAX_SERVICES + 1}
  `
  );
  const truncated = rows.length > MAX_SERVICES;
  const services = rows
    .slice(0, MAX_SERVICES)
    .reverse()
    .map((r) => ({
      t: r.date,
      kind: 'service' as const,
      vehicleId: r.vehicle_id,
      vehicleName: scope.names.get(r.vehicle_id) ?? 'Unknown vehicle',
      label: r.description?.trim() || 'Maintenance',
      amount: r.amount,
    }));
  return { services, truncated };
}

export async function tripLane(
  db: AsyncAppDatabase,
  scope: Scope,
  buckets: Array<{ start: number; end: number }>,
  units: { user: UnitPreferences; byVehicle: Map<string, UnitPreferences> }
): Promise<TripLane> {
  const lane: TripLane = { count: buckets.map(() => 0), distance: buckets.map(() => 0) };
  if (scope.vehicleIds.length === 0 || buckets.length === 0) return lane;
  const rows = await rawAll<{ date: number; vehicle_id: string; distance: number }>(
    db,
    sql`
    SELECT t.trip_date AS date, t.vehicle_id, t.end_odometer - t.start_odometer AS distance FROM trips t
    WHERE t.user_id = ${scope.userId} AND t.vehicle_id IN (${inList(scope.vehicleIds)})
      AND t.trip_date >= ${scope.start} AND t.trip_date < ${scope.end}
  `
  );
  for (const row of rows) {
    const i = buckets.findIndex((b) => row.date >= b.start && row.date < b.end);
    if (i < 0) continue;
    const from = units.byVehicle.get(row.vehicle_id)?.distanceUnit ?? units.user.distanceUnit;
    lane.count[i] = (lane.count[i] ?? 0) + 1;
    lane.distance[i] =
      (lane.distance[i] ?? 0) +
      convertDistance(Math.max(0, row.distance), from, units.user.distanceUnit);
  }
  return lane;
}
