import { and, eq, isNull, notInArray, type SQL, sql } from 'drizzle-orm';
import { appContext } from '../app-context';
import type { AsyncAppDatabase } from '../db/async-sqlite';
import { expenses, vehicleShares, vehicles } from '../db/schema';
import { NotFoundError } from '../errors';
import { resolverFor } from '../permissions/grants';

export type VehicleRole = 'owner' | 'editor' | 'viewer';
export type VehicleAccessMode = 'read' | 'write' | 'owner';

export interface VehicleAccess {
  role: VehicleRole;
  ownerId: string;
  financials: { read: boolean; write: boolean };
}

const FINANCIAL_READS = ['vehicle.financing.read', 'vehicle.insurance.read'] as const;
const FINANCIAL_WRITES = ['vehicle.financing.write', 'vehicle.insurance.write'] as const;

async function memberFinancials(
  db: AsyncAppDatabase,
  vehicleId: string,
  userId: string
): Promise<VehicleAccess['financials']> {
  const vehicle = { kind: 'vehicle' as const, vehicleId };
  const resolver = await resolverFor(userId, [vehicle], db);
  const holdsAll = (permissions: readonly string[]) =>
    permissions.every((p) => resolver.can(p, vehicle).allow);
  return { read: holdsAll(FINANCIAL_READS), write: holdsAll(FINANCIAL_WRITES) };
}

const ROLES_FOR_MODE: Record<VehicleAccessMode, readonly VehicleRole[]> = {
  read: ['owner', 'editor', 'viewer'],
  write: ['owner', 'editor'],
  owner: ['owner'],
};

// Authorize against vehicles.userId; vehicle_shares.ownerId is only a list key.
export async function resolveVehicleAccess(
  vehicleId: string,
  userId: string,
  db: AsyncAppDatabase = appContext().asyncDb
): Promise<VehicleAccess | null> {
  const rows = await db
    .select({ ownerId: vehicles.userId, level: vehicleShares.level })
    .from(vehicles)
    .leftJoin(
      vehicleShares,
      and(
        eq(vehicleShares.vehicleId, vehicles.id),
        eq(vehicleShares.sharedWithId, userId),
        eq(vehicleShares.status, 'accepted')
      )
    )
    .where(eq(vehicles.id, vehicleId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.ownerId === userId) {
    return { role: 'owner', ownerId: row.ownerId, financials: { read: true, write: true } };
  }
  if (row.level === null) return null;
  return {
    role: row.level === 'editor' ? 'editor' : 'viewer',
    ownerId: row.ownerId,
    financials: await memberFinancials(db, vehicleId, userId),
  };
}

export function allowsMode(
  access: VehicleAccess | null,
  mode: VehicleAccessMode
): access is VehicleAccess {
  return access !== null && ROLES_FOR_MODE[mode].includes(access.role);
}

export async function requireVehicleAccess(
  vehicleId: string,
  userId: string,
  mode: VehicleAccessMode,
  db: AsyncAppDatabase = appContext().asyncDb
): Promise<VehicleAccess> {
  const access = await resolveVehicleAccess(vehicleId, userId, db);
  // 404, not 403, so a non-member cannot learn that the vehicle exists.
  if (!allowsMode(access, mode)) throw new NotFoundError('Vehicle');
  return access;
}

export async function requireVehiclesAccess(
  vehicleIds: readonly string[],
  userId: string,
  mode: VehicleAccessMode,
  db: AsyncAppDatabase = appContext().asyncDb
): Promise<Set<string>> {
  const ownerIds = new Set<string>();
  for (const vehicleId of new Set(vehicleIds)) {
    ownerIds.add((await requireVehicleAccess(vehicleId, userId, mode, db)).ownerId);
  }
  return ownerIds;
}

export function ownedVehiclesScope(userId: string): SQL {
  return eq(vehicles.userId, userId);
}

const FINANCIAL_SOURCE_TYPES = ['financing', 'insurance_term'] as const;

export function seesFinancials(access: VehicleAccess): boolean {
  return access.financials.read;
}

export function writesFinancials(access: VehicleAccess): boolean {
  return access.financials.write;
}

export async function resolveExpenseReadScope(
  vehicleId: string | undefined,
  userId: string
): Promise<{ userId: string; hideFinancials: boolean }> {
  if (!vehicleId) return { userId, hideFinancials: false };
  const access = await requireVehicleAccess(vehicleId, userId, 'read');
  return { userId: access.ownerId, hideFinancials: !seesFinancials(access) };
}

function isFinancialSource(sourceType: string | null | undefined): boolean {
  return (FINANCIAL_SOURCE_TYPES as readonly (string | null | undefined)[]).includes(sourceType);
}

export function hiddenFinancialsScope(): SQL {
  return sql`(${isNull(expenses.sourceType)} or ${notInArray(expenses.sourceType, [...FINANCIAL_SOURCE_TYPES])})`;
}

export function assertMayTouchFinancialExpense(
  mayTouchFinancials: boolean,
  ...sourceTypes: (string | null | undefined)[]
): void {
  if (!mayTouchFinancials && sourceTypes.some(isFinancialSource)) {
    throw new NotFoundError('Expense');
  }
}

export function sharedVehicleView<T extends Record<string, unknown>>(vehicle: T): T {
  const { financing: _financing, userId: _userId, ...rest } = vehicle;
  return { ...rest, purchasePrice: null, vin: null } as unknown as T;
}
