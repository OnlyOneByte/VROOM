import { and, count, eq, isNull } from 'drizzle-orm';
import type { AsyncAppDatabase, AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import {
  users,
  type VehicleDriver,
  vehicleDrivers,
  vehicleShares,
  vehicles,
} from '../../db/schema';

export const DRIVER_COLORS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-8',
] as const;

export interface DriverView {
  id: string;
  vehicleId: string;
  userId: string | null;
  name: string;
  color: string | null;
  archived: boolean;
}

async function memberName(tx: AsyncHandle, userId: string): Promise<string> {
  const row = await tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .then(firstRow);
  return row?.name || 'Driver';
}

function colorAfter(used: number): string {
  return DRIVER_COLORS[used % DRIVER_COLORS.length] ?? 'chart-1';
}

async function nextColor(db: AsyncHandle, vehicleId: string): Promise<string> {
  const [row] = await db
    .select({ used: count() })
    .from(vehicleDrivers)
    .where(eq(vehicleDrivers.vehicleId, vehicleId));
  return colorAfter(row?.used ?? 0);
}

export async function carShareEnabled(tx: AsyncHandle, vehicleId: string): Promise<boolean> {
  const row = await tx
    .select({ enabled: vehicles.carShareEnabled })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .then(firstRow);
  return row?.enabled ?? false;
}

export async function listDrivers(db: AsyncAppDatabase, vehicleId: string): Promise<DriverView[]> {
  const rows = await db
    .select({ driver: vehicleDrivers, displayName: users.displayName })
    .from(vehicleDrivers)
    .leftJoin(users, eq(users.id, vehicleDrivers.userId))
    .where(eq(vehicleDrivers.vehicleId, vehicleId))
    .orderBy(vehicleDrivers.createdAt);
  return rows.map(({ driver, displayName }) => ({
    id: driver.id,
    vehicleId: driver.vehicleId,
    userId: driver.userId,
    name: driver.userId && displayName ? displayName : driver.name,
    color: driver.color,
    archived: driver.archivedAt !== null,
  }));
}

export async function findDriver(
  db: AsyncAppDatabase,
  vehicleId: string,
  driverId: string
): Promise<VehicleDriver | null> {
  const row = await db
    .select()
    .from(vehicleDrivers)
    .where(and(eq(vehicleDrivers.id, driverId), eq(vehicleDrivers.vehicleId, vehicleId)))
    .then(firstRow);
  return row ?? null;
}

export async function ownDriverId(
  db: AsyncAppDatabase,
  vehicleId: string,
  userId: string
): Promise<string | null> {
  const row = await db
    .select({ id: vehicleDrivers.id })
    .from(vehicleDrivers)
    .where(
      and(
        eq(vehicleDrivers.vehicleId, vehicleId),
        eq(vehicleDrivers.userId, userId),
        isNull(vehicleDrivers.archivedAt)
      )
    )
    .then(firstRow);
  return row?.id ?? null;
}

export async function ensureMemberDriver(
  tx: AsyncHandle,
  vehicleId: string,
  userId: string
): Promise<void> {
  const existing = await tx
    .select({ id: vehicleDrivers.id })
    .from(vehicleDrivers)
    .where(and(eq(vehicleDrivers.vehicleId, vehicleId), eq(vehicleDrivers.userId, userId)))
    .then(firstRow);
  if (existing) {
    await tx
      .update(vehicleDrivers)
      .set({ archivedAt: null })
      .where(eq(vehicleDrivers.id, existing.id));
    return;
  }
  await tx.insert(vehicleDrivers).values({
    vehicleId,
    userId,
    name: await memberName(tx, userId),
    color: await nextColor(tx, vehicleId),
    createdBy: userId,
  });
}

export async function setCarShare(
  asyncDb: AsyncAppDatabase,
  vehicleId: string,
  enabled: boolean
): Promise<void> {
  await asyncDb.transaction(async (tx) => {
    await tx
      .update(vehicles)
      .set({ carShareEnabled: enabled, updatedAt: new Date() })
      .where(eq(vehicles.id, vehicleId));
    if (!enabled) return;
    const owner = await tx
      .select({ userId: vehicles.userId })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .then(firstRow);
    const members = await tx
      .select({ userId: vehicleShares.sharedWithId })
      .from(vehicleShares)
      .where(and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.status, 'accepted')));
    for (const userId of [owner?.userId, ...members.map((m) => m.userId)]) {
      if (userId) await ensureMemberDriver(tx, vehicleId, userId);
    }
  });
}

export async function addGuestDriver(
  db: AsyncAppDatabase,
  vehicleId: string,
  input: { name: string; color?: string },
  createdBy: string
): Promise<string> {
  const color = input.color ?? (await nextColor(db, vehicleId));
  const [row] = await db
    .insert(vehicleDrivers)
    .values({ vehicleId, name: input.name, color, createdBy })
    .returning({ id: vehicleDrivers.id });
  if (!row) throw new Error('Driver insert returned no row');
  return row.id;
}

export async function updateDriver(
  db: AsyncAppDatabase,
  driverId: string,
  changes: { name?: string; color?: string; archivedAt?: Date | null }
): Promise<void> {
  await db.update(vehicleDrivers).set(changes).where(eq(vehicleDrivers.id, driverId));
}
