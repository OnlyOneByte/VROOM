/**
 * Round-trip + scoping guard for the push-subscription store (push-notifications T1).
 *
 * Drives the REAL PushSubscriptionRepository against a fresh in-memory DB built from the actual
 * migration chain (loadMigrations → applyMigration), so it ALSO proves migration 0013 applies
 * cleanly (the table + its indexes exist) — the merge-surviving net for the additive table.
 *
 * Pins the contract the routes (T3) + the send hook (T4) depend on:
 *   - upsertByEndpoint persists + reads back, and is IDEMPOTENT on (userId, endpoint): a
 *     re-subscribe from the same browser UPDATES the keys + RESETS failureCount, never duplicates.
 *   - findByUser is userId-scoped (a user sees only their own devices).
 *   - deleteByEndpoint is userId-scoped: user A cannot delete user B's subscription via the
 *     endpoint alone (the IDOR discipline — the endpoint is not a capability).
 *   - markSuccess / incrementFailure / prune drive the reaping lifecycle (#135 hygiene).
 *
 * Fresh per-test DB (the date-range-boundary.test.ts pattern) — host-TZ-independent, no shared
 * DB-singleton import trap.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { PushSubscriptionRepository } from '../repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: PushSubscriptionRepository;

const USER_A = 'user-a';
const USER_B = 'user-b';

function seed(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_B}', 'b@test.com', 'B')`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new PushSubscriptionRepository(db);
  seed();
});

afterEach(() => {
  sqliteDb.close();
});

const SUB_A = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-a',
  p256dh: 'BPp256dhKeyAAA',
  auth: 'authSecretAAA',
  userAgent: 'Chrome on Pixel',
};

describe('PushSubscriptionRepository (push-notifications T1)', () => {
  test('migration 0013 applied: the table + a subscription round-trips', async () => {
    const stored = await repo.upsertByEndpoint(USER_A, SUB_A);
    expect(stored.id).toBeTruthy();
    expect(stored.userId).toBe(USER_A);
    expect(stored.endpoint).toBe(SUB_A.endpoint);
    expect(stored.p256dh).toBe(SUB_A.p256dh);
    expect(stored.auth).toBe(SUB_A.auth);
    expect(stored.userAgent).toBe(SUB_A.userAgent);
    expect(stored.failureCount).toBe(0);

    const found = await repo.findByUser(USER_A);
    expect(found).toHaveLength(1);
    expect(found[0].endpoint).toBe(SUB_A.endpoint);
  });

  test('upsertByEndpoint is idempotent on (userId, endpoint) — re-subscribe updates, never duplicates', async () => {
    await repo.upsertByEndpoint(USER_A, SUB_A);
    // Same endpoint, rotated keys (the browser re-subscribed); also bump+reset failure path.
    const updated = await repo.upsertByEndpoint(USER_A, {
      ...SUB_A,
      p256dh: 'BPp256dhKeyROTATED',
      auth: 'authSecretROTATED',
      userAgent: 'Chrome on Pixel 2',
    });

    const all = await repo.findByUser(USER_A);
    expect(all).toHaveLength(1); // NOT 2 — the same device, updated in place
    expect(updated.p256dh).toBe('BPp256dhKeyROTATED');
    expect(updated.auth).toBe('authSecretROTATED');
    expect(updated.userAgent).toBe('Chrome on Pixel 2');
    expect(updated.failureCount).toBe(0);
  });

  test('a second endpoint for the same user is a distinct device (many devices per user)', async () => {
    await repo.upsertByEndpoint(USER_A, SUB_A);
    await repo.upsertByEndpoint(USER_A, {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/device-b',
      p256dh: 'BPotherKey',
      auth: 'otherAuth',
    });
    const all = await repo.findByUser(USER_A);
    expect(all).toHaveLength(2);
  });

  test('findByUser is userId-scoped — a user sees only their own devices', async () => {
    await repo.upsertByEndpoint(USER_A, SUB_A);
    await repo.upsertByEndpoint(USER_B, {
      ...SUB_A,
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-b',
    });

    expect(await repo.findByUser(USER_A)).toHaveLength(1);
    expect((await repo.findByUser(USER_A))[0].userId).toBe(USER_A);
    expect(await repo.findByUser(USER_B)).toHaveLength(1);
  });

  test('deleteByEndpoint is userId-scoped (IDOR) — user B cannot delete user A subscription', async () => {
    await repo.upsertByEndpoint(USER_A, SUB_A);

    // User B tries to delete user A's endpoint — no row of B's matches → no-op.
    const bDeletedAs = await repo.deleteByEndpoint(USER_B, SUB_A.endpoint);
    expect(bDeletedAs).toBe(false);
    expect(await repo.findByUser(USER_A)).toHaveLength(1); // A's subscription survives

    // The owner can delete it.
    const aDeleted = await repo.deleteByEndpoint(USER_A, SUB_A.endpoint);
    expect(aDeleted).toBe(true);
    expect(await repo.findByUser(USER_A)).toHaveLength(0);
  });

  test('reaping lifecycle: incrementFailure counts, markSuccess resets, prune removes', async () => {
    const stored = await repo.upsertByEndpoint(USER_A, SUB_A);

    expect(await repo.incrementFailure(stored.id)).toBe(1);
    expect(await repo.incrementFailure(stored.id)).toBe(2);

    await repo.markSuccess(stored.id);
    const afterSuccess = (await repo.findByUser(USER_A))[0];
    expect(afterSuccess.failureCount).toBe(0);
    expect(afterSuccess.lastSuccessAt).toBeInstanceOf(Date);

    await repo.prune(stored.id);
    expect(await repo.findByUser(USER_A)).toHaveLength(0);
  });

  test('a deleted user cascades away their subscriptions (FK onDelete cascade)', async () => {
    await repo.upsertByEndpoint(USER_A, SUB_A);
    sqliteDb.run(`DELETE FROM users WHERE id = '${USER_A}'`);
    expect(await repo.findByUser(USER_A)).toHaveLength(0);
  });
});
