import { and, count, eq, isNull } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import type { AppDatabase } from '../../db/connection';
import {
  users,
  type VehicleDriver,
  vehicleDrivers,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';

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

function memberName(tx: DrizzleTransaction, userId: string): string {
  const row = tx.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).get();
  return row?.name || 'Driver';
}

function colorAfter(used: number): string {
  return DRIVER_COLORS[used % DRIVER_COLORS.length] ?? 'chart-1';
}

function nextColor(tx: DrizzleTransaction, vehicleId: string): string {
  const [row] = tx
    .select({ used: count() })
    .from(vehicleDrivers)
    .where(eq(vehicleDrivers.vehicleId, vehicleId))
    .all();
  return colorAfter(row?.used ?? 0);
}

export function carShareEnabled(tx: DrizzleTransaction, vehicleId: string): boolean {
  const row = tx
    .select({ enabled: vehicles.carShareEnabled })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .get();
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
    .get();
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
    .get();
  return row?.id ?? null;
}

export function ensureMemberDriver(
  tx: DrizzleTransaction,
  vehicleId: string,
  userId: string
): void {
  const existing = tx
    .select({ id: vehicleDrivers.id })
    .from(vehicleDrivers)
    .where(and(eq(vehicleDrivers.vehicleId, vehicleId), eq(vehicleDrivers.userId, userId)))
    .get();
  if (existing) {
    tx.update(vehicleDrivers)
      .set({ archivedAt: null })
      .where(eq(vehicleDrivers.id, existing.id))
      .run();
    return;
  }
  tx.insert(vehicleDrivers)
    .values({
      vehicleId,
      userId,
      name: memberName(tx, userId),
      color: nextColor(tx, vehicleId),
      createdBy: userId,
    })
    .run();
}

export function setCarShare(db: AppDatabase, vehicleId: string, enabled: boolean): void {
  db.transaction((tx) => {
    tx.update(vehicles)
      .set({ carShareEnabled: enabled, updatedAt: new Date() })
      .where(eq(vehicles.id, vehicleId))
      .run();
    if (!enabled) return;
    const owner = tx
      .select({ userId: vehicles.userId })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .get();
    const members = tx
      .select({ userId: vehicleShares.sharedWithId })
      .from(vehicleShares)
      .where(and(eq(vehicleShares.vehicleId, vehicleId), eq(vehicleShares.status, 'accepted')))
      .all();
    for (const userId of [owner?.userId, ...members.map((m) => m.userId)]) {
      if (userId) ensureMemberDriver(tx, vehicleId, userId);
    }
  });
}

export async function addGuestDriver(
  db: AsyncAppDatabase,
  vehicleId: string,
  input: { name: string; color?: string },
  createdBy: string
): Promise<string> {
  let color = input.color;
  if (!color) {
    const [row] = await db
      .select({ used: count() })
      .from(vehicleDrivers)
      .where(eq(vehicleDrivers.vehicleId, vehicleId));
    color = colorAfter(row?.used ?? 0);
  }
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
