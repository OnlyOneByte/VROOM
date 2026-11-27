import { and, type Column, desc, eq, isNull } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../../db/async-sqlite';
import type { AppDatabase } from '../../db/connection';
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
import { listDrivers } from './repository';

export type BackfillRequest =
  | { mode: 'logged' }
  | { mode: 'range'; driverId: string; from: number; to: number };

type Kind = BackfilledEntry['kind'];
type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

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
    .get();
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

function setDriver(
  tx: Tx,
  entry: BackfilledEntry,
  from: string | null,
  to: string | null,
  hideFinancials: boolean
): boolean {
  const match = (column: Column) => (from === null ? isNull(column) : eq(column, from));
  if (entry.kind === 'trip') {
    return (
      tx
        .update(trips)
        .set({ driverId: to })
        .where(and(eq(trips.id, entry.id), match(trips.driverId)))
        .returning({ id: trips.id })
        .all().length > 0
    );
  }
  if (entry.kind === 'reading') {
    return (
      tx
        .update(odometerEntries)
        .set({ driverId: to })
        .where(and(eq(odometerEntries.id, entry.id), match(odometerEntries.driverId)))
        .returning({ id: odometerEntries.id })
        .all().length > 0
    );
  }
  return (
    tx
      .update(expenses)
      .set({ paidByDriverId: to })
      .where(
        and(
          eq(expenses.id, entry.id),
          match(expenses.paidByDriverId),
          visibleExpenses(hideFinancials)
        )
      )
      .returning({ id: expenses.id })
      .all().length > 0
  );
}

export function applyBackfill(
  db: AppDatabase,
  vehicleId: string,
  mode: BackfillRequest['mode'],
  planned: BackfilledEntry[],
  userId: string,
  hideFinancials: boolean
): { batchId: string | null; entries: BackfilledEntry[] } {
  return db.transaction((tx) => {
    const applied = planned.filter((entry) =>
      setDriver(tx, entry, null, entry.driverId, hideFinancials)
    );
    if (applied.length === 0) return { batchId: null, entries: applied };
    const batch = tx
      .insert(driverBackfills)
      .values({ vehicleId, mode, entries: applied, createdBy: userId })
      .returning({ id: driverBackfills.id })
      .get();
    return { batchId: batch.id, entries: applied };
  });
}

function stillPaidBy(tx: Tx, entry: BackfilledEntry): boolean {
  const row = tx
    .select({ payer: expenses.paidByDriverId })
    .from(expenses)
    .where(eq(expenses.id, entry.id))
    .get();
  return row?.payer === entry.driverId;
}

export function undoBackfill(
  db: AppDatabase,
  vehicleId: string,
  batchId: string,
  hideFinancials: boolean
): number {
  return db.transaction((tx) => {
    const batch = tx
      .select()
      .from(driverBackfills)
      .where(and(eq(driverBackfills.id, batchId), eq(driverBackfills.vehicleId, vehicleId)))
      .get();
    if (!batch || batch.undoneAt) throw new NotFoundError('Backfill');
    const kept: BackfilledEntry[] = [];
    let reverted = 0;
    for (const entry of batch.entries) {
      if (setDriver(tx, entry, entry.driverId, null, hideFinancials)) reverted++;
      else if (hideFinancials && entry.kind === 'expense' && stillPaidBy(tx, entry))
        kept.push(entry);
    }
    tx.update(driverBackfills)
      .set(kept.length > 0 ? { entries: kept } : { undoneAt: new Date() })
      .where(eq(driverBackfills.id, batchId))
      .run();
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
