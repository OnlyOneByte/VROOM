/**
 * vehicle-sharing T5a — GET /api/v1/vehicles?include=shared (the read-only fleet-list widening).
 *
 * The ONLY widening shipped this cycle: an ACCEPTED share makes the owner's vehicle appear in the
 * invitee's fleet list (annotated sharedAccess { level, sharedBy }), owned ∪ accepted-shared. The
 * editor-WRITE widening on expenses (T5b) is escalated to Angelo (the expense read/write/backup model
 * is userId-keyed, not vehicleId-keyed — a naive gate-flip would mis-stamp money rows), so this test
 * pins ONLY the additive read widening + that it does NOT leak on pending/declined/revoked or to
 * non-shared third parties.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // owner (user A)
let bCookie: string; // invitee B's session
let bId: string;
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  bId = `fleet-invitee-${++bCounter}`;
  bEmail = `fleet-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Invitee B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface VehicleRow {
  id: string;
  make: string;
  sharedAccess?: { level: string; sharedBy: string };
}

async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

/** A owns a vehicle and invites B at `level`; returns [vehicleId, shareId]. */
async function shareWithB(level: 'viewer' | 'editor'): Promise<[string, string]> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const res = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return [vehicleId, body.data.id];
}

describe('GET /vehicles?include=shared — fleet-list widening (T5a, R3)', () => {
  test('an ACCEPTED share makes the owner vehicle appear in B fleet, annotated sharedAccess', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    await asB('POST', `/api/v1/shares/${shareId}/accept`);

    // Without ?include=shared, B sees only their own (none).
    const ownOnly = await json<DataEnvelope<VehicleRow[]>>(await asB('GET', '/api/v1/vehicles'));
    expect(ownOnly.data.find((v) => v.id === vehicleId)).toBeUndefined();

    // With ?include=shared, the shared vehicle appears, annotated.
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    const row = withShared.data.find((v) => v.id === vehicleId);
    expect(row, 'shared vehicle should appear with include=shared').toBeDefined();
    expect(row?.sharedAccess?.level).toBe('viewer');
    expect(row?.sharedAccess?.sharedBy).toBe(ctx.user.displayName);
  });

  test('a PENDING (not yet accepted) share does NOT appear in the shared fleet', async () => {
    const [vehicleId] = await shareWithB('editor'); // invited, not accepted
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(withShared.data.find((v) => v.id === vehicleId)).toBeUndefined();
  });

  test('a DECLINED share does NOT appear (no fleet visibility after decline)', async () => {
    const [vehicleId, shareId] = await shareWithB('viewer');
    await asB('POST', `/api/v1/shares/${shareId}/accept`);
    await asB('POST', `/api/v1/shares/${shareId}/decline`); // self-remove
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(withShared.data.find((v) => v.id === vehicleId)).toBeUndefined();
  });

  test('a non-shared third party never sees the vehicle (no leak)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2021 });
    // B has no share at all → not in their shared fleet.
    const withShared = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(withShared.data.find((v) => v.id === vehicleId)).toBeUndefined();
  });

  test('owned vehicles carry NO sharedAccess annotation', async () => {
    await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2021 });
    const list = await json<DataEnvelope<VehicleRow[]>>(
      await ctx.authed('GET', '/api/v1/vehicles?include=shared')
    );
    const owned = list.data.find((v) => v.make === 'Owned');
    expect(owned).toBeDefined();
    expect(owned?.sharedAccess).toBeUndefined();
  });
});

/**
 * vehicle-sharing T13 — the full lifecycle round-trip through the REAL stack, as a TRACKED HTTP-harness
 * test (not an untracked browser e2e). The browser FE→render legs are already eyes-on-verified (T12b-1
 * drove accept; T12b-2 shot the "shared by" fleet badge), and the GUIDE's standing truth is "source-scan
 * guards > untracked e2e for merge survival" — an untracked *.meshclaw.e2e.ts vanishes on merge, and a
 * browser spec cannot even set up the OWNER (auth is OAuth-only, no HTTP signup). So the durable artifact
 * is this lifecycle assertion. It walks the exact T13 sequence — owner invites → invitee accepts (vehicle
 * appears in the invitee fleet) → owner REVOKES → vehicle is GONE from the fleet — closing the D8
 * revoke→gone-from-fleet leg, which no existing test pinned (shares-routes pins revoke→slot-freed only).
 */
describe('vehicle-sharing T13 — invite → accept → appears → revoke → gone (lifecycle, D8)', () => {
  test('the owner revoking an ACCEPTED share removes the vehicle from the invitee fleet', async () => {
    // 1. Owner A shares a vehicle with invitee B; B accepts.
    const [vehicleId, shareId] = await shareWithB('editor');
    expect((await asB('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);

    // 2. The accepted vehicle is now in B's shared fleet, annotated.
    const afterAccept = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    const accepted = afterAccept.data.find((v) => v.id === vehicleId);
    expect(accepted, 'accepted vehicle is in the invitee fleet').toBeDefined();
    expect(accepted?.sharedAccess?.level).toBe('editor');

    // 3. Owner A revokes the share (D8 — the DELETE flips status to revoked).
    expect((await ctx.authed('DELETE', `/api/v1/shares/${shareId}`)).status).toBe(200);

    // 4. The vehicle is GONE from B's fleet — a revoked grant confers NO fleet visibility (the leg
    //    no prior test pinned). B's owned fleet is unaffected (B never owned it).
    const afterRevoke = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    expect(
      afterRevoke.data.find((v) => v.id === vehicleId),
      'revoked vehicle must disappear from the invitee fleet'
    ).toBeUndefined();
  });

  test('a re-invite after revoke, re-accepted, brings the vehicle BACK to the invitee fleet', async () => {
    // The slot frees on revoke (partial-unique excludes revoked), so the owner can re-share the same
    // vehicle with the same invitee — the full reversible lifecycle, not a one-way door.
    const [vehicleId, shareId] = await shareWithB('viewer');
    await asB('POST', `/api/v1/shares/${shareId}/accept`);
    await ctx.authed('DELETE', `/api/v1/shares/${shareId}`); // revoke → gone

    // Re-invite (a fresh share row), B re-accepts.
    const reinvite = await ctx.authed('POST', '/api/v1/shares', {
      vehicleId,
      email: bEmail,
      level: 'editor',
    });
    const reBody = await json<DataEnvelope<{ id: string }>>(reinvite);
    expect(reinvite.status, JSON.stringify(reBody)).toBe(201);
    expect((await asB('POST', `/api/v1/shares/${reBody.data.id}/accept`)).status).toBe(200);

    const back = await json<DataEnvelope<VehicleRow[]>>(
      await asB('GET', '/api/v1/vehicles?include=shared')
    );
    const row = back.data.find((v) => v.id === vehicleId);
    expect(row, 'the re-accepted vehicle returns to the invitee fleet').toBeDefined();
    // The new grant's level (editor) is reflected, not the revoked one's (viewer).
    expect(row?.sharedAccess?.level).toBe('editor');
  });
});
