import type { Context } from 'hono';
import { appContext, repos } from '../../app-context';
import { ForbiddenError, ValidationError } from '../../errors';
import { loadResolver, requestResolver } from '../../permissions/grants';
import { findDriver, ownDriverId } from './repository';

type DriverField = 'driverId' | 'paidByDriverId';

function mayRecordOthers(c: Context, vehicleId: string): boolean {
  return requestResolver(c).can('vehicle.driver.record', {
    kind: 'vehicle',
    vehicleId,
  }).allow;
}

export function maySeeDrivers(c: Context, vehicleId: string): boolean {
  const resolver = requestResolver(c);
  const vehicle = { kind: 'vehicle' as const, vehicleId };
  return (
    resolver.can('vehicle.driver.record', vehicle).allow ||
    resolver.can('vehicle.driver_stats.read', vehicle).allow
  );
}

export function carShareAccess(c: Context, vehicleId: string, enabled: boolean) {
  const resolver = requestResolver(c);
  const vehicle = { kind: 'vehicle' as const, vehicleId };
  return {
    enabled,
    manage: resolver.can('vehicle.driver.manage', vehicle).allow,
    record: resolver.can('vehicle.driver.record', vehicle).allow,
  };
}

async function assertActiveDriver(vehicleId: string, driverId: string): Promise<void> {
  const driver = await findDriver(appContext().asyncDb, vehicleId, driverId);
  if (!driver || driver.archivedAt !== null) {
    throw new ValidationError("That driver doesn't drive this vehicle");
  }
}

async function assertMayAttribute(
  c: Context,
  vehicleId: string,
  requested: string | null,
  current: string | null | undefined
): Promise<void> {
  await loadResolver(c, [{ kind: 'vehicle', vehicleId }]);
  if (mayRecordOthers(c, vehicleId)) return;
  const own = await ownDriverId(appContext().asyncDb, vehicleId, c.get('user').id);
  if (current && current !== own) {
    throw new ForbiddenError("Only people who record drivers can change someone else's entry");
  }
  if (requested !== null && requested !== own) {
    throw new ForbiddenError('You can only record yourself as the driver');
  }
}

export async function assertMayClearDriver(
  c: Context,
  vehicleId: string,
  current: string | null
): Promise<void> {
  if (current) await assertMayAttribute(c, vehicleId, null, current);
}

export async function attributedDriver(
  c: Context,
  vehicleId: string,
  requested: string | null | undefined,
  current?: string | null
): Promise<string | null | undefined> {
  const db = appContext().asyncDb;
  const userId = c.get('user').id;
  const creating = current === undefined;
  const vehicle = await repos().vehicles.findById(vehicleId);
  if (!vehicle?.carShareEnabled) {
    if (requested) throw new ValidationError('Car sharing is off for this vehicle');
    return creating ? null : undefined;
  }
  if (requested === undefined) return creating ? ownDriverId(db, vehicleId, userId) : undefined;
  if (requested !== null) await assertActiveDriver(vehicleId, requested);
  await assertMayAttribute(c, vehicleId, requested, current);
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

export function memberView<T extends object>(
  c: Context,
  vehicleId: string,
  value: T,
  fields?: readonly DriverField[]
): T {
  const shown = hideDriverFields(c, vehicleId, value, fields) as Record<string, unknown>;
  if (shown['userId'] === c.get('user').id) return shown as T;
  if (!('userId' in shown) && !('createdBy' in shown)) return shown as T;
  const { userId: _userId, createdBy: _createdBy, ...rest } = shown;
  return rest as T;
}
