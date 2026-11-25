import type { Context } from 'hono';
import { getDb } from '../../db/connection';
import { ForbiddenError, ValidationError } from '../../errors';
import { requestResolver } from '../../permissions/grants';
import { carShareEnabled, findDriver, ownDriverId } from './repository';

type DriverField = 'driverId' | 'paidByDriverId';

function mayRecordOthers(c: Context, vehicleId: string): boolean {
  return requestResolver(c, getDb()).can('vehicle.driver.record', { kind: 'vehicle', vehicleId })
    .allow;
}

export function maySeeDrivers(c: Context, vehicleId: string): boolean {
  const resolver = requestResolver(c, getDb());
  const vehicle = { kind: 'vehicle' as const, vehicleId };
  return (
    resolver.can('vehicle.driver.record', vehicle).allow ||
    resolver.can('vehicle.driver_stats.read', vehicle).allow
  );
}

function assertActiveDriver(vehicleId: string, driverId: string): void {
  const driver = findDriver(getDb(), vehicleId, driverId);
  if (!driver || driver.archivedAt !== null) {
    throw new ValidationError("That driver doesn't drive this vehicle");
  }
}

function assertMayAttribute(
  c: Context,
  vehicleId: string,
  requested: string | null,
  current: string | null | undefined
): void {
  if (mayRecordOthers(c, vehicleId)) return;
  const own = ownDriverId(getDb(), vehicleId, c.get('user').id);
  if (current && current !== own) {
    throw new ForbiddenError("Only people who record drivers can change someone else's entry");
  }
  if (requested !== null && requested !== own) {
    throw new ForbiddenError('You can only record yourself as the driver');
  }
}

export function assertMayClearDriver(c: Context, vehicleId: string, current: string | null): void {
  if (current) assertMayAttribute(c, vehicleId, null, current);
}

export function attributedDriver(
  c: Context,
  vehicleId: string,
  requested: string | null | undefined,
  current?: string | null
): string | null | undefined {
  const db = getDb();
  const userId = c.get('user').id;
  const creating = current === undefined;
  if (!carShareEnabled(db, vehicleId)) {
    if (requested) throw new ValidationError('Car sharing is off for this vehicle');
    return creating ? null : undefined;
  }
  if (requested === undefined) return creating ? ownDriverId(db, vehicleId, userId) : undefined;
  if (requested !== null) assertActiveDriver(vehicleId, requested);
  assertMayAttribute(c, vehicleId, requested, current);
  return requested;
}

export function hideDriverFields<T extends object>(
  c: Context,
  vehicleId: string,
  value: T,
  fields: readonly DriverField[] = ['driverId', 'paidByDriverId']
): T {
  if (maySeeDrivers(c, vehicleId)) return value;
  const copy = { ...value } as Record<string, unknown>;
  for (const field of fields) delete copy[field];
  return copy as T;
}
