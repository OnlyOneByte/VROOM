import type { SQL } from 'drizzle-orm';
import type { AsyncHandle } from '../../db/async-sqlite';
import { expenses } from '../../db/schema';

const UPDATED_AT_STEP_MS = 1000;

export function latestOf(times: (Date | null)[]): Date | null {
  const latest = times.reduce((max, d) => Math.max(max, d?.getTime() ?? 0), 0);
  return latest > 0 ? new Date(latest) : null;
}

export function nextUpdatedAt(previous: (Date | null)[]): Date {
  const latest = latestOf(previous)?.getTime() ?? 0;
  return new Date(Math.max(Date.now(), latest + UPDATED_AT_STEP_MS));
}

export async function nextUpdatedAtFor(tx: AsyncHandle, where: SQL | undefined): Promise<Date> {
  const rows = await tx.select({ updatedAt: expenses.updatedAt }).from(expenses).where(where);
  return nextUpdatedAt(rows.map((row) => row.updatedAt));
}
