import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../db/connection';
import * as schema from '../../db/schema';
import { NotFoundError } from '../../errors';
import {
  requireVehicleAccess,
  resolveVehicleAccess,
  type VehicleAccessMode,
} from '../vehicle-access';

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

  for (const id of [OWNER, INVITEE, STRANGER]) {
    sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      id,
      `${id}@test.com`,
      id,
    ]);
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

function share(status: string, level = 'viewer', sharedWith = INVITEE): void {
  sqlite.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [`s-${status}-${level}-${sharedWith}`, VEHICLE, OWNER, sharedWith, level, status]
  );
}

describe('resolveVehicleAccess', () => {
  test('the owner resolves to owner without a share row', async () => {
    expect(await resolveVehicleAccess(VEHICLE, OWNER, db)).toEqual({
      role: 'owner',
      ownerId: OWNER,
    });
  });

  test('accepted viewer and editor shares resolve to their level, scoped to the owner', async () => {
    share('accepted', 'viewer');
    share('accepted', 'editor', STRANGER);
    expect(await resolveVehicleAccess(VEHICLE, INVITEE, db)).toEqual({
      role: 'viewer',
      ownerId: OWNER,
    });
    expect(await resolveVehicleAccess(VEHICLE, STRANGER, db)).toEqual({
      role: 'editor',
      ownerId: OWNER,
    });
  });

  test('pending, declined and revoked shares grant nothing', async () => {
    for (const status of ['pending', 'declined', 'revoked']) {
      sqlite.run('DELETE FROM vehicle_shares');
      share(status, 'editor');
      expect(await resolveVehicleAccess(VEHICLE, INVITEE, db), status).toBeNull();
    }
  });

  test('a revoked share next to a new accepted one resolves to the accepted level', async () => {
    share('revoked', 'editor');
    share('accepted', 'viewer');
    expect(await resolveVehicleAccess(VEHICLE, INVITEE, db)).toEqual({
      role: 'viewer',
      ownerId: OWNER,
    });
  });

  test('a stranger and a missing vehicle both resolve to null', async () => {
    share('accepted', 'editor');
    expect(await resolveVehicleAccess(VEHICLE, STRANGER, db)).toBeNull();
    expect(await resolveVehicleAccess('does-not-exist', OWNER, db)).toBeNull();
  });

  test('ownership comes from vehicles.userId, not the share row ownerId', async () => {
    share('accepted', 'editor', STRANGER);
    sqlite.run('UPDATE vehicle_shares SET owner_id = ? WHERE shared_with_id = ?', [
      STRANGER,
      STRANGER,
    ]);
    expect(await resolveVehicleAccess(VEHICLE, STRANGER, db)).toEqual({
      role: 'editor',
      ownerId: OWNER,
    });
  });
});

describe('requireVehicleAccess', () => {
  const cases: [string, (() => void) | null, string, Record<VehicleAccessMode, boolean>][] = [
    ['owner', null, OWNER, { read: true, write: true, owner: true }],
    [
      'editor',
      () => share('accepted', 'editor'),
      INVITEE,
      { read: true, write: true, owner: false },
    ],
    [
      'viewer',
      () => share('accepted', 'viewer'),
      INVITEE,
      { read: true, write: false, owner: false },
    ],
    [
      'pending',
      () => share('pending', 'editor'),
      INVITEE,
      { read: false, write: false, owner: false },
    ],
    ['stranger', null, STRANGER, { read: false, write: false, owner: false }],
  ];

  for (const [who, setup, userId, allowed] of cases) {
    for (const mode of ['read', 'write', 'owner'] as const) {
      test(`${who} ${allowed[mode] ? 'passes' : 'gets NotFound on'} ${mode}`, async () => {
        setup?.();
        const attempt = requireVehicleAccess(VEHICLE, userId, mode, db);
        if (allowed[mode]) {
          expect((await attempt).ownerId).toBe(OWNER);
        } else {
          await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
        }
      });
    }
  }
});
