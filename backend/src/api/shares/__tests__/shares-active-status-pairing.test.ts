// createTestApp() must run before any DB-bound import: import only the harness and bun:test.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function indexActiveStatuses(): string[] {
  const row = ctx.sqlite
    .query(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get('vehicle_shares_active_idx') as { sql: string } | null;
  expect(row?.sql).toBeString();

  const where = /where\s+status\s+in\s*\(([^)]*)\)/i.exec(row?.sql ?? '');
  expect(where).not.toBeNull();
  return (where?.[1] ?? '')
    .split(',')
    .map((literal) => literal.trim().replace(/^'|'$/g, ''))
    .sort();
}

function seedShare(id: string, status: string, vehicleId: string, sharedWithId: string): void {
  ctx.sqlite.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at)
     VALUES (?, ?, ?, ?, 'viewer', ?, unixepoch())`,
    [id, vehicleId, ctx.user.id, sharedWithId, status]
  );
}

function seedVehicle(id: string): void {
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year, created_at, updated_at)
     VALUES (?, ?, 'Honda', 'Civic', 2020, unixepoch(), unixepoch())`,
    [id, ctx.user.id]
  );
}

function seedInvitee(id: string): void {
  ctx.sqlite.run(`INSERT INTO users (id, email, display_name) VALUES (?, ?, 'Invitee')`, [
    id,
    `${id}@example.com`,
  ]);
}

describe('active-share status pairing', () => {
  test('the partial unique index lists exactly ACTIVE_SHARE_STATUSES', async () => {
    const { ACTIVE_SHARE_STATUSES } = await import('../repository');

    expect(indexActiveStatuses()).toEqual([...ACTIVE_SHARE_STATUSES].sort());
  });

  test('isActiveShareStatus accepts every listed status and nothing else', async () => {
    const { ACTIVE_SHARE_STATUSES, isActiveShareStatus } = await import('../repository');

    for (const status of ACTIVE_SHARE_STATUSES) {
      expect(isActiveShareStatus(status)).toBe(true);
    }
    for (const status of ['declined', 'revoked', '', 'Pending']) {
      expect(isActiveShareStatus(status)).toBe(false);
    }
  });

  test('the dup-invite gate admits exactly the statuses the index reserves a slot for', async () => {
    const { vehicleShareRepository } = await import('../repository');

    const slotHolders = indexActiveStatuses();

    seedVehicle('veh-1');
    for (const status of ['pending', 'accepted', 'declined', 'revoked']) {
      const invitee = `invitee-${status}`;
      seedInvitee(invitee);
      seedShare(`share-${status}`, status, 'veh-1', invitee);

      const found = await vehicleShareRepository.findActiveForVehicleAndUser('veh-1', invitee);
      expect(found !== null).toBe(slotHolders.includes(status));
    }
  });

  test('"shared with me" surfaces exactly the active statuses', async () => {
    const { vehicleShareRepository } = await import('../repository');

    seedInvitee('invitee-multi');
    for (const status of ['pending', 'accepted', 'declined', 'revoked']) {
      seedVehicle(`veh-${status}`);
      seedShare(`recv-${status}`, status, `veh-${status}`, 'invitee-multi');
    }

    const received = await vehicleShareRepository.findReceivedByUser('invitee-multi');
    expect(received.map((s) => s.status).sort()).toEqual(['accepted', 'pending']);
  });
});
