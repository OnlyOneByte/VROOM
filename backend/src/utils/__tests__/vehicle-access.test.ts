import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../db/connection';
import * as schema from '../../db/schema';
import { NotFoundError } from '../../errors';
import {
  readableVehiclesScope,
  requireVehicleAccess,
  requireVehiclesAccess,
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

describe('requireVehiclesAccess', () => {
  function addVehicle(id: string, owner: string): void {
    sqlite.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
      id,
      owner,
      'Mazda',
      '3',
      2020,
    ]);
  }

  test('returns one owner id per distinct owner, ignoring repeated vehicles', async () => {
    addVehicle('v-own', INVITEE);
    share('accepted', 'editor');
    const owners = await requireVehiclesAccess([VEHICLE, 'v-own', VEHICLE], INVITEE, 'write', db);
    expect([...owners].sort()).toEqual([OWNER, INVITEE].sort());
  });

  test('an empty list passes with no owners', async () => {
    expect((await requireVehiclesAccess([], STRANGER, 'owner', db)).size).toBe(0);
  });

  test('one inaccessible vehicle fails the whole list', async () => {
    addVehicle('v-own', INVITEE);
    await expect(
      requireVehiclesAccess(['v-own', VEHICLE], INVITEE, 'read', db)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('readableVehiclesScope', () => {
  const OTHER_VEHICLE = 'v-unshared';

  beforeEach(() => {
    sqlite.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
      OTHER_VEHICLE,
      OWNER,
      'Mazda',
      '3',
      2019,
    ]);
  });

  async function readableIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: schema.vehicles.id })
      .from(schema.vehicles)
      .where(readableVehiclesScope(schema.vehicles.id, schema.vehicles.userId, userId, db));
    return rows.map((row) => row.id).sort();
  }

  test('the owner reads every vehicle they own', async () => {
    expect(await readableIds(OWNER)).toEqual([OTHER_VEHICLE, VEHICLE].sort());
  });

  test('an accepted share reads only the shared vehicle, even from a vehicles query', async () => {
    share('accepted', 'viewer');
    expect(await readableIds(INVITEE)).toEqual([VEHICLE]);
  });

  test('pending, declined and revoked shares and strangers read nothing', async () => {
    for (const status of ['pending', 'declined', 'revoked']) {
      sqlite.run('DELETE FROM vehicle_shares');
      share(status, 'editor');
      expect(await readableIds(INVITEE), status).toEqual([]);
    }
    expect(await readableIds(STRANGER)).toEqual([]);
  });
});
