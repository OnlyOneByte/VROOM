/**
 * Tests for offline-outbox idempotent expense creation (createIdempotent).
 *
 * Validates: offline-entries Requirements 6.1, 6.2, 6.3
 * - Same (userId, clientId) twice → one row, second call returns the original.
 * - Same clientId across different users → two distinct rows (per-user isolation).
 * - No clientId → plain create (no idempotency).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import type { NewExpense } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { expenses } from '../../../db/schema';
import { ExpenseRepository } from '../repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: ExpenseRepository;

const USER_A = 'user-a';
const USER_B = 'user-b';
const VEHICLE_A = 'veh-a';
const VEHICLE_B = 'veh-b';

function seed(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A'), ('${USER_B}', 'b@test.com', 'B')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_A}', '${USER_A}', 'Toyota', 'Camry', 2022), ('${VEHICLE_B}', '${USER_B}', 'Honda', 'Civic', 2021)`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new ExpenseRepository(db);
  seed();
});

afterEach(() => {
  sqliteDb.close();
});

function expenseInput(overrides: Partial<NewExpense>): NewExpense {
  return {
    vehicleId: VEHICLE_A,
    userId: USER_A,
    category: 'fuel',
    date: new Date('2026-01-15'),
    expenseAmount: 42.5,
    ...overrides,
  } as NewExpense;
}

function countRows(): number {
  return db.select().from(expenses).all().length;
}

describe('createIdempotent', () => {
  test('same (userId, clientId) twice creates exactly one row', async () => {
    const input = expenseInput({ clientId: 'client-key-1' });

    const first = await repo.createIdempotent(input);
    const second = await repo.createIdempotent(input);

    expect(second.id).toBe(first.id);
    expect(countRows()).toBe(1);
  });

  test('second call returns the original row, not a mutated copy', async () => {
    const first = await repo.createIdempotent(
      expenseInput({ clientId: 'client-key-2', expenseAmount: 10 })
    );
    // A retry with a different amount must NOT overwrite the original (LWW is a
    // separate update op, not a create). The original wins.
    const second = await repo.createIdempotent(
      expenseInput({ clientId: 'client-key-2', expenseAmount: 999 })
    );

    expect(second.id).toBe(first.id);
    expect(second.expenseAmount).toBe(10);
    expect(countRows()).toBe(1);
  });

  test('same clientId across different users yields two distinct rows', async () => {
    const a = await repo.createIdempotent(
      expenseInput({ userId: USER_A, vehicleId: VEHICLE_A, clientId: 'shared-key' })
    );
    const b = await repo.createIdempotent(
      expenseInput({ userId: USER_B, vehicleId: VEHICLE_B, clientId: 'shared-key' })
    );

    expect(b.id).not.toBe(a.id);
    expect(countRows()).toBe(2);
  });

  test('no clientId falls back to plain create (no dedup)', async () => {
    await repo.createIdempotent(expenseInput({}));
    await repo.createIdempotent(expenseInput({}));

    expect(countRows()).toBe(2);
  });

  test('findByClientId is user-scoped', async () => {
    await repo.createIdempotent(
      expenseInput({ userId: USER_A, vehicleId: VEHICLE_A, clientId: 'scoped-key' })
    );

    expect(await repo.findByClientId('scoped-key', USER_A)).not.toBeNull();
    expect(await repo.findByClientId('scoped-key', USER_B)).toBeNull();
  });
});

// #98 (C51): a conflict-resolution keep-local must APPLY the local edit on a (userId, clientId) collision,
// not silently no-op-return the stored row (NORTH_STAR #1: a resolved offline edit is never lost). The
// pre-fix sync-manager sent forceOverwrite but the backend (a) Zod-stripped it and (b) createIdempotent
// returned the existing row unchanged. These pin the overwrite path: same row id (in-place update, no
// duplicate), the local fields applied, and the identity + idempotency keys (id/userId/clientId) immutable.
describe('createIdempotent — overwrite (keep-local conflict resolution, #98)', () => {
  test('overwrite=true on a clientId collision UPDATES the existing row in place (no duplicate)', async () => {
    const first = await repo.createIdempotent(
      expenseInput({
        clientId: 'ov-1',
        expenseAmount: 10,
        category: 'fuel',
        mileage: 30000,
        volume: 9,
      })
    );

    // The local edit: a different amount + mileage. keep-local must win.
    const resolved = await repo.createIdempotent(
      expenseInput({
        clientId: 'ov-1',
        expenseAmount: 55,
        category: 'fuel',
        mileage: 30500,
        volume: 12,
      }),
      true
    );

    expect(resolved.id, 'same row updated in place').toBe(first.id);
    expect(resolved.expenseAmount, 'local amount applied').toBe(55);
    expect(resolved.mileage).toBe(30500);
    expect(countRows(), 'no duplicate row').toBe(1);

    // Re-read confirms it persisted (not just the returned object).
    const reread = await repo.findByClientId('ov-1', USER_A);
    expect(reread?.expenseAmount).toBe(55);
  });

  test('the identity + idempotency keys (id/userId/clientId) are immutable across an overwrite', async () => {
    const first = await repo.createIdempotent(
      expenseInput({ clientId: 'ov-2', expenseAmount: 10 })
    );

    // Even if a (hypothetically tampered) payload carried a different userId, the existing row's identity
    // must not change — the overwrite strips clientId/userId from the patch.
    const resolved = await repo.createIdempotent(
      expenseInput({ clientId: 'ov-2', expenseAmount: 77 }),
      true
    );

    expect(resolved.id).toBe(first.id);
    expect(resolved.userId).toBe(USER_A);
    expect(resolved.clientId).toBe('ov-2');
    expect(resolved.expenseAmount).toBe(77);
  });

  test('overwrite=false (default) still no-ops on collision — the plain-retry contract is unchanged', async () => {
    const first = await repo.createIdempotent(
      expenseInput({ clientId: 'ov-3', expenseAmount: 10 })
    );
    const retry = await repo.createIdempotent(
      expenseInput({ clientId: 'ov-3', expenseAmount: 999 }),
      false
    );

    expect(retry.id).toBe(first.id);
    expect(retry.expenseAmount, 'a blind retry must NOT overwrite').toBe(10);
    expect(countRows()).toBe(1);
  });

  test('overwrite on a clientId that does NOT exist yet is a plain create', async () => {
    const created = await repo.createIdempotent(
      expenseInput({ clientId: 'ov-4', expenseAmount: 33 }),
      true
    );
    expect(created.expenseAmount).toBe(33);
    expect(countRows()).toBe(1);
  });
});
