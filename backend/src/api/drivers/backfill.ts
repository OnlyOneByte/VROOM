import { and, type Column, desc, eq, isNull } from 'drizzle-orm';
import type { AsyncAppDatabase, AsyncHandle } from '../../db/async-sqlite';
import { firstRow } from '../../db/first-row';
import {
  type BackfilledEntry,
  driverBackfills,
  expenses,
  odometerEntries,
  trips,
  vehicleDrivers,
  vehicles,
} from '../../db/schema';
import { NotFoundError } from '../../errors';
import { hiddenFinancialsScope } from '../../utils/vehicle-access';
import { nextUpdatedAtFor } from '../expenses/updated-at';
import { carShareEnabled, listDrivers } from './repository';

export type BackfillRequest =
  | { mode: 'logged' }
  | { mode: 'range'; driverId: string; from: number; to: number };

type Kind = BackfilledEntry['kind'];

interface Candidate {
  kind: Kind;
  id: string;
  createdBy: string | null;
  at: Date;
}

const RECENT_BATCHES = 5;

function visibleExpenses(hideFinancials: boolean) {
  return hideFinancials ? hiddenFinancialsScope() : undefined;
}

async function unattributed(
  db: AsyncAppDatabase,
  vehicleId: string,
  hideFinancials: boolean
): Promise<Candidate[]> {
  const tripRows = await db
    .select({ id: trips.id, createdBy: trips.createdBy, at: trips.tripDate })
    .from(trips)
    .where(and(eq(trips.vehicleId, vehicleId), isNull(trips.driverId)));
  const readingRows = await db
    .select({
      id: odometerEntries.id,
      createdBy: odometerEntries.createdBy,
      at: odometerEntries.recordedAt,
    })
    .from(odometerEntries)
    .where(and(eq(odometerEntries.vehicleId, vehicleId), isNull(odometerEntries.driverId)));
  const expenseRows = await db
    .select({ id: expenses.id, createdBy: expenses.createdBy, at: expenses.date })
    .from(expenses)
    .where(
      and(
        eq(expenses.vehicleId, vehicleId),
        isNull(expenses.paidByDriverId),
        visibleExpenses(hideFinancials)
      )
    );
  return [
    ...tripRows.map((r) => ({ ...r, kind: 'trip' as const })),
    ...readingRows.map((r) => ({ ...r, kind: 'reading' as const })),
    ...expenseRows.map((r) => ({ ...r, kind: 'expense' as const })),
  ];
}

async function memberDrivers(db: AsyncAppDatabase, vehicleId: string) {
  const rows = await db
    .select({ id: vehicleDrivers.id, userId: vehicleDrivers.userId })
    .from(vehicleDrivers)
    .where(eq(vehicleDrivers.vehicleId, vehicleId));
  return new Map(rows.flatMap((r) => (r.userId ? [[r.userId, r.id] as const] : [])));
}

export async function planBackfill(
  db: AsyncAppDatabase,
  vehicleId: string,
  request: BackfillRequest,
  hideFinancials: boolean
): Promise<BackfilledEntry[]> {
  const candidates = await unattributed(db, vehicleId, hideFinancials);
  if (request.mode === 'range') {
    return candidates
      .filter((c) => c.at.getTime() >= request.from && c.at.getTime() <= request.to)
      .map((c) => ({ kind: c.kind, id: c.id, driverId: request.driverId }));
  }
  const ownerRow = await db
    .select({ userId: vehicles.userId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
    .then(firstRow);
  const owner = ownerRow?.userId;
  const byUser = await memberDrivers(db, vehicleId);
  return candidates.flatMap((c) => {
    const driverId = byUser.get(c.createdBy ?? owner ?? '');
    return driverId ? [{ kind: c.kind, id: c.id, driverId }] : [];
  });
}

export async function summarize(
  db: AsyncAppDatabase,
  vehicleId: string,
  entries: BackfilledEntry[]
) {
  const names = new Map((await listDrivers(db, vehicleId)).map((d) => [d.id, d.name]));
  const count = (kind: Kind) => entries.filter((e) => e.kind === kind).length;
  const perDriver = new Map<string, number>();
  for (const entry of entries)
    perDriver.set(entry.driverId, (perDriver.get(entry.driverId) ?? 0) + 1);
  return {
    total: entries.length,
    trips: count('trip'),
    readings: count('reading'),
    expenses: count('expense'),
    byDriver: [...perDriver].map(([driverId, n]) => ({
      driverId,
      name: names.get(driverId) ?? 'Driver',
      count: n,
    })),
  };
}

async function setDriver(
  tx: AsyncHandle,
  vehicleId: string,
  entry: BackfilledEntry,
  from: string | null,
  to: string | null,
  hideFinancials: boolean
): Promise<boolean> {
  const match = (column: Column) => (from === null ? isNull(column) : eq(column, from));
  if (entry.kind === 'trip') {
    const rows = await tx
      .update(trips)
      .set({ driverId: to })
      .where(and(eq(trips.id, entry.id), eq(trips.vehicleId, vehicleId), match(trips.driverId)))
      .returning({ id: trips.id });
    return rows.length > 0;
  }
  if (entry.kind === 'reading') {
    const rows = await tx
      .update(odometerEntries)
      .set({ driverId: to })
      .where(
        and(
          eq(odometerEntries.id, entry.id),
          eq(odometerEntries.vehicleId, vehicleId),
          match(odometerEntries.driverId)
        )
      )
      .returning({ id: odometerEntries.id });
    return rows.length > 0;
  }
  const target = and(
    eq(expenses.id, entry.id),
    eq(expenses.vehicleId, vehicleId),
    match(expenses.paidByDriverId),
    visibleExpenses(hideFinancials)
  );
  const rows = await tx
    .update(expenses)
    .set({ paidByDriverId: to, updatedAt: await nextUpdatedAtFor(tx, target) })
    .where(target)
    .returning({ id: expenses.id });
  return rows.length > 0;
}

async function requireCarShareIn(tx: AsyncHandle, vehicleId: string): Promise<void> {
  if (!(await carShareEnabled(tx, vehicleId))) throw new NotFoundError('Car sharing');
}

async function driverIds(tx: AsyncHandle, vehicleId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: vehicleDrivers.id })
    .from(vehicleDrivers)
    .where(eq(vehicleDrivers.vehicleId, vehicleId));
  return new Set(rows.map((row) => row.id));
}

export function applyBackfill(
  asyncDb: AsyncAppDatabase,
  vehicleId: string,
  mode: BackfillRequest['mode'],
  planned: BackfilledEntry[],
  userId: string,
  hideFinancials: boolean
): Promise<{ batchId: string | null; entries: BackfilledEntry[] }> {
  return asyncDb.transaction(async (tx) => {
    await requireCarShareIn(tx, vehicleId);
    const drivers = await driverIds(tx, vehicleId);
    const applied: BackfilledEntry[] = [];
    for (const entry of planned.filter((e) => drivers.has(e.driverId))) {
      if (await setDriver(tx, vehicleId, entry, null, entry.driverId, hideFinancials))
        applied.push(entry);
    }
    if (applied.length === 0) return { batchId: null, entries: applied };
    const [batch] = await tx
      .insert(driverBackfills)
      .values({ vehicleId, mode, entries: applied, createdBy: userId })
      .returning({ id: driverBackfills.id });
    if (!batch) throw new Error('Backfill insert returned no row');
    return { batchId: batch.id, entries: applied };
  });
}

async function stillPaidBy(tx: AsyncHandle, entry: BackfilledEntry): Promise<boolean> {
  const row = await tx
    .select({ payer: expenses.paidByDriverId })
    .from(expenses)
    .where(eq(expenses.id, entry.id))
    .then(firstRow);
  return row?.payer === entry.driverId;
}

export function undoBackfill(
  asyncDb: AsyncAppDatabase,
  vehicleId: string,
  batchId: string,
  hideFinancials: boolean
): Promise<number> {
  return asyncDb.transaction(async (tx) => {
    await requireCarShareIn(tx, vehicleId);
    const batch = await tx
      .select()
      .from(driverBackfills)
      .where(and(eq(driverBackfills.id, batchId), eq(driverBackfills.vehicleId, vehicleId)))
      .then(firstRow);
    if (!batch || batch.undoneAt) throw new NotFoundError('Backfill');
    const kept: BackfilledEntry[] = [];
    let reverted = 0;
    for (const entry of batch.entries) {
      if (await setDriver(tx, vehicleId, entry, entry.driverId, null, hideFinancials)) reverted++;
      else if (hideFinancials && entry.kind === 'expense' && (await stillPaidBy(tx, entry)))
        kept.push(entry);
    }
    await tx
      .update(driverBackfills)
      .set(kept.length > 0 ? { entries: kept } : { undoneAt: new Date() })
      .where(eq(driverBackfills.id, batchId));
    return reverted;
  });
}

export async function recentBackfills(db: AsyncAppDatabase, vehicleId: string) {
  const batches = await db
    .select()
    .from(driverBackfills)
    .where(and(eq(driverBackfills.vehicleId, vehicleId), isNull(driverBackfills.undoneAt)))
    .orderBy(desc(driverBackfills.createdAt))
    .limit(RECENT_BATCHES);
  return batches.map((batch) => ({
    id: batch.id,
    mode: batch.mode,
    createdAt: batch.createdAt,
    total: batch.entries.length,
  }));
}
