import { and, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import {
  users,
  type VehicleDriver,
  vehicleDrivers,
  vehicleShares,
  vehicles,
} from '../../db/schema';
import type { DrizzleTransaction } from '../../db/types';

type Db = AppDatabase | DrizzleTransaction;

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

function memberName(db: Db, userId: string): string {
  const row = db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).get();
  return row?.name || 'Driver';
}

function nextColor(db: Db, vehicleId: string): string {
  const used = db
    .select({ color: vehicleDrivers.color })
    .from(vehicleDrivers)
    .where(eq(vehicleDrivers.vehicleId, vehicleId))
    .all().length;
  return DRIVER_COLORS[used % DRIVER_COLORS.length] ?? 'chart-1';
}

export function carShareEnabled(db: Db, vehicleId: string): boolean {
  const row = db
    .select({ enabled: vehicles.carShareEnabled })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .get();
  return row?.enabled ?? false;
}

export function listDrivers(db: Db, vehicleId: string): DriverView[] {
  return db
    .select({ driver: vehicleDrivers, displayName: users.displayName })
    .from(vehicleDrivers)
    .leftJoin(users, eq(users.id, vehicleDrivers.userId))
    .where(eq(vehicleDrivers.vehicleId, vehicleId))
    .orderBy(vehicleDrivers.createdAt)
    .all()
    .map(({ driver, displayName }) => ({
      id: driver.id,
      vehicleId: driver.vehicleId,
      userId: driver.userId,
      name: driver.userId && displayName ? displayName : driver.name,
      color: driver.color,
      archived: driver.archivedAt !== null,
    }));
}

export function findDriver(db: Db, vehicleId: string, driverId: string): VehicleDriver | null {
  return (
    db
      .select()
      .from(vehicleDrivers)
      .where(and(eq(vehicleDrivers.id, driverId), eq(vehicleDrivers.vehicleId, vehicleId)))
      .get() ?? null
  );
}

export function ownDriverId(db: Db, vehicleId: string, userId: string): string | null {
  const row = db
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

export function ensureMemberDriver(db: Db, vehicleId: string, userId: string): void {
  const existing = db
    .select({ id: vehicleDrivers.id })
    .from(vehicleDrivers)
    .where(and(eq(vehicleDrivers.vehicleId, vehicleId), eq(vehicleDrivers.userId, userId)))
    .get();
  if (existing) {
    db.update(vehicleDrivers)
      .set({ archivedAt: null })
      .where(eq(vehicleDrivers.id, existing.id))
      .run();
    return;
  }
  db.insert(vehicleDrivers)
    .values({
      vehicleId,
      userId,
      name: memberName(db, userId),
      color: nextColor(db, vehicleId),
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

export function addGuestDriver(
  db: Db,
  vehicleId: string,
  input: { name: string; color?: string },
  createdBy: string
): string {
  const row = db
    .insert(vehicleDrivers)
    .values({
      vehicleId,
      name: input.name,
      color: input.color ?? nextColor(db, vehicleId),
      createdBy,
    })
    .returning({ id: vehicleDrivers.id })
    .get();
  return row.id;
}

export function updateDriver(
  db: Db,
  driverId: string,
  changes: { name?: string; color?: string; archivedAt?: Date | null }
): void {
  db.update(vehicleDrivers).set(changes).where(eq(vehicleDrivers.id, driverId)).run();
}
