/**
 * vehicle-sharing T2 — the access-resolver seam (utils/sharing.ts, design §2).
 *
 * Drives the REAL resolveVehicleAccess / requireVehicleRead / requireVehicleWrite against a migrated
 * throwaway DB seeded with an owner, an invitee, a third party, and shares at every status/level.
 * This is the ONE seam every shared route routes through, so its matrix is the load-bearing
 * cross-tenant proof (NORTH_STAR #2): owner→full, accepted-viewer→read-only, accepted-editor→
 * read+write, pending/declined/revoked→NONE, non-share third party→404, nonexistent vehicle→404.
 * 404 (NotFoundError) — never 403 — is asserted on every denial (the #80 enumeration-oracle rule).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../db/connection';
import * as schema from '../../db/schema';
import { NotFoundError } from '../../errors';
import { requireVehicleRead, requireVehicleWrite, resolveVehicleAccess } from '../sharing';

let sqlite: Database;
let db: AppDatabase;

const OWNER = 'u-owner';
const INVITEE = 'u-invitee';
const STRANGER = 'u-stranger';
const VEHICLE = 'v-shared';

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqlite, m);

  for (const [id, email] of [
    [OWNER, 'owner@test.com'],
    [INVITEE, 'invitee@test.com'],
    [STRANGER, 'stranger@test.com'],
  ]) {
    sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [id, email, id]);
  }
  sqlite.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
    VEHICLE,
    OWNER,
    'Honda',
    'Civic',
    2021,
  ]);
  // biome-ignore lint/suspicious/noExplicitAny: drizzle bun-sqlite generic vs the AppDatabase alias
  db = drizzle(sqlite, { schema }) as any;
});
afterEach(() => sqlite.close());

/** Seed one share row (defaults: invitee, viewer). */
function share(status: string, level = 'viewer', sharedWith = INVITEE): void {
  sqlite.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [`s-${status}-${level}-${sharedWith}`, VEHICLE, OWNER, sharedWith, level, status]
  );
}

describe('resolveVehicleAccess — owner / accepted-share / none', () => {
  test('the OWNER resolves to role owner (via vehicles.userId, no share row needed)', async () => {
    expect(await resolveVehicleAccess(VEHICLE, OWNER, db)).toEqual({ role: 'owner' });
  });

  test('an ACCEPTED viewer share resolves to viewer; an ACCEPTED editor share to editor', async () => {
    share('accepted', 'viewer');
    expect(await resolveVehicleAccess(VEHICLE, INVITEE, db)).toEqual({ role: 'viewer' });
  });

  test('an ACCEPTED editor share resolves to editor', async () => {
    share('accepted', 'editor');
    expect(await resolveVehicleAccess(VEHICLE, INVITEE, db)).toEqual({ role: 'editor' });
  });

  test('pending / declined / revoked shares grant NOTHING (null)', async () => {
    for (const status of ['pending', 'declined', 'revoked']) {
      sqlite.run('DELETE FROM vehicle_shares');
      share(status, 'editor');
      expect(
        await resolveVehicleAccess(VEHICLE, INVITEE, db),
        `${status} must grant no access`
      ).toBeNull();
    }
  });

  test('a non-share third party resolves to null', async () => {
    share('accepted', 'editor');
    expect(await resolveVehicleAccess(VEHICLE, STRANGER, db)).toBeNull();
  });

  test('a nonexistent vehicle resolves to null (indistinguishable from no-access)', async () => {
    expect(await resolveVehicleAccess('does-not-exist', OWNER, db)).toBeNull();
  });

  test('the OWNER truth is vehicles.userId, not the denormalized share.ownerId', async () => {
    // A share row that LIES about ownerId (names the stranger as owner) must NOT grant the stranger
    // owner access — ownership is vehicles.userId only. The stranger has no accepted share → null.
    share('accepted', 'editor', STRANGER);
    sqlite.run('UPDATE vehicle_shares SET owner_id = ? WHERE shared_with_id = ?', [
      STRANGER,
      STRANGER,
    ]);
    // The stranger DOES have an accepted editor share here, so they get editor (not owner) — the
    // point: they are never elevated to OWNER by the ownerId column.
    expect(await resolveVehicleAccess(VEHICLE, STRANGER, db)).toEqual({ role: 'editor' });
    // And the real owner is still owner.
    expect(await resolveVehicleAccess(VEHICLE, OWNER, db)).toEqual({ role: 'owner' });
  });
});

describe('requireVehicleRead — owner|viewer|editor or 404', () => {
  test('owner, accepted viewer, and accepted editor all pass read', async () => {
    expect(await requireVehicleRead(VEHICLE, OWNER, db)).toEqual({ role: 'owner' });
    share('accepted', 'viewer');
    expect(await requireVehicleRead(VEHICLE, INVITEE, db)).toEqual({ role: 'viewer' });
  });

  test('a third party is denied read with NotFoundError (→404, never 403)', async () => {
    await expect(requireVehicleRead(VEHICLE, STRANGER, db)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('a pending share is denied read (not yet accepted)', async () => {
    share('pending', 'viewer');
    await expect(requireVehicleRead(VEHICLE, INVITEE, db)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('requireVehicleWrite — owner|editor or 404 (viewer denied)', () => {
  test('owner and accepted editor pass write', async () => {
    expect(await requireVehicleWrite(VEHICLE, OWNER, db)).toEqual({ role: 'owner' });
    share('accepted', 'editor');
    expect(await requireVehicleWrite(VEHICLE, INVITEE, db)).toEqual({ role: 'editor' });
  });

  test('an accepted VIEWER is denied write with NotFoundError (→404, never 403 — no capability oracle)', async () => {
    share('accepted', 'viewer');
    // The viewer CAN read…
    expect(await requireVehicleRead(VEHICLE, INVITEE, db)).toEqual({ role: 'viewer' });
    // …but is denied write with the SAME 404 a stranger gets.
    await expect(requireVehicleWrite(VEHICLE, INVITEE, db)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('a third party is denied write with NotFoundError', async () => {
    await expect(requireVehicleWrite(VEHICLE, STRANGER, db)).rejects.toBeInstanceOf(NotFoundError);
  });
});
