/**
 * vehicle-sharing T3 — owner-side /api/v1/shares router (HTTP harness).
 *
 * Drives the REAL app over an in-memory DB: invite an existing user to a vehicle I own, list shares I
 * granted, change a level, revoke. Pins R1/R5 happy paths + the owner-side rejections (self-invite,
 * unknown email, dup active share, re-invite-after-revoke). The CROSS-TENANT denials (a non-owner
 * cannot invite/list/change/revoke on someone else's vehicle) live in cross-tenant-idor.test.ts (the
 * R6 sweep, same cycle). createTestApp() seeds user A; a second user B is minted on the same DB.
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
let bId: string; // invitee (user B)
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  bId = `share-invitee-${++bCounter}`;
  bEmail = `invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Invitee B' });
});
afterEach(() => ctx.close());

interface Share {
  id: string;
  vehicleId: string;
  ownerId: string;
  sharedWithId: string;
  level: string;
  status: string;
}

async function invite(
  vehicleId: string,
  email: string,
  level: 'viewer' | 'editor'
): Promise<Response> {
  return ctx.authed('POST', '/api/v1/shares', { vehicleId, email, level });
}

describe('POST /api/v1/shares — owner invites an existing user (R1)', () => {
  test('owner invites user B as viewer → 201 pending share', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const res = await invite(vehicleId, bEmail, 'viewer');
    const body = await json<DataEnvelope<Share>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data.sharedWithId).toBe(bId);
    expect(body.data.ownerId).toBe(ctx.user.id);
    expect(body.data.level).toBe('viewer');
    expect(body.data.status).toBe('pending');
  });

  test('inviting an unknown email → 404 (no VROOM account)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const res = await invite(vehicleId, 'nobody@nowhere.com', 'viewer');
    expect(res.status).toBe(404);
  });

  test('self-invite is rejected (422/400 ValidationError)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const res = await invite(vehicleId, ctx.user.email, 'editor');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('a duplicate ACTIVE share is rejected with 409', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    expect((await invite(vehicleId, bEmail, 'viewer')).status).toBe(201);
    const dup = await invite(vehicleId, bEmail, 'editor');
    expect(dup.status).toBe(409);
  });

  test('inviting a vehicle I do not own → 404 (existence-hiding)', async () => {
    const res = await invite('no-such-vehicle', bEmail, 'viewer');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/shares/granted — owner-side list (R5)', () => {
  test('lists only shares I granted', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2020 });
    await invite(v1, bEmail, 'viewer');
    await invite(v2, bEmail, 'editor');

    const res = await ctx.authed('GET', '/api/v1/shares/granted');
    const body = await json<DataEnvelope<Share[]>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data.every((s) => s.ownerId === ctx.user.id)).toBe(true);
  });
});

describe('PUT /api/v1/shares/:id — change level; DELETE — revoke (R5/D8)', () => {
  test('owner changes a share level viewer → editor', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await json<DataEnvelope<Share>>(await invite(vehicleId, bEmail, 'viewer'));
    const res = await ctx.authed('PUT', `/api/v1/shares/${created.data.id}`, { level: 'editor' });
    const body = await json<DataEnvelope<Share>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.level).toBe('editor');
  });

  test('owner revokes a share → 200, and the user can be re-invited (slot freed)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await json<DataEnvelope<Share>>(await invite(vehicleId, bEmail, 'viewer'));

    const del = await ctx.authed('DELETE', `/api/v1/shares/${created.data.id}`);
    expect(del.status).toBe(200);

    // The revoked row freed the partial-unique active slot → a fresh invite succeeds.
    const reinvite = await invite(vehicleId, bEmail, 'editor');
    expect(reinvite.status).toBe(201);
  });

  test('PUT/DELETE on a nonexistent share → 404', async () => {
    expect((await ctx.authed('PUT', '/api/v1/shares/nope', { level: 'viewer' })).status).toBe(404);
    expect((await ctx.authed('DELETE', '/api/v1/shares/nope')).status).toBe(404);
  });
});

describe('invitee side — /received, accept, decline (T4, R2/R5)', () => {
  // Mint a real session for the invitee B so we can act AS B (accept/decline are sharedWithId-scoped).
  async function asInvitee(method: string, path: string, body?: unknown): Promise<Response> {
    const { lucia } = await import('../../auth/lucia');
    const session = await lucia.createSession(bId, {});
    const sc = lucia.createSessionCookie(session.id);
    const headers: Record<string, string> = {
      Cookie: `${sc.name}=${sc.value}`,
      'Sec-Fetch-Site': 'same-origin',
    };
    let init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init = { ...init, body: JSON.stringify(body) };
    }
    return ctx.app.request(path, init);
  }

  test('invitee sees a pending invite in /received, accepts it → accepted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await json<DataEnvelope<Share>>(await invite(vehicleId, bEmail, 'viewer'));

    const recv = await json<DataEnvelope<Share[]>>(
      await asInvitee('GET', '/api/v1/shares/received')
    );
    expect(recv.data.length).toBe(1);
    expect(recv.data[0].id).toBe(created.data.id);
    expect(recv.data[0].status).toBe('pending');

    const acc = await asInvitee('POST', `/api/v1/shares/${created.data.id}/accept`);
    const accBody = await json<DataEnvelope<Share>>(acc);
    expect(acc.status, JSON.stringify(accBody)).toBe(200);
    expect(accBody.data.status).toBe('accepted');
  });

  test('invitee declines a pending invite → declined, and slot frees for re-invite', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await json<DataEnvelope<Share>>(await invite(vehicleId, bEmail, 'viewer'));

    const dec = await asInvitee('POST', `/api/v1/shares/${created.data.id}/decline`);
    expect(dec.status).toBe(200);

    // Declining freed the active slot → owner can re-invite.
    expect((await invite(vehicleId, bEmail, 'editor')).status).toBe(201);
  });

  test('invitee self-removes an ACCEPTED share via decline', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await json<DataEnvelope<Share>>(await invite(vehicleId, bEmail, 'editor'));
    expect((await asInvitee('POST', `/api/v1/shares/${created.data.id}/accept`)).status).toBe(200);

    const dec = await asInvitee('POST', `/api/v1/shares/${created.data.id}/decline`);
    expect(dec.status).toBe(200);
    // No longer in the invitee's received list (declined is filtered out).
    const recv = await json<DataEnvelope<Share[]>>(
      await asInvitee('GET', '/api/v1/shares/received')
    );
    expect(recv.data.length).toBe(0);
  });

  test('accepting a non-pending (already declined) share → 409', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await json<DataEnvelope<Share>>(await invite(vehicleId, bEmail, 'viewer'));
    expect((await asInvitee('POST', `/api/v1/shares/${created.data.id}/decline`)).status).toBe(200);
    expect((await asInvitee('POST', `/api/v1/shares/${created.data.id}/accept`)).status).toBe(409);
  });

  test('accept/decline on a nonexistent share → 404', async () => {
    expect((await asInvitee('POST', '/api/v1/shares/nope/accept')).status).toBe(404);
    expect((await asInvitee('POST', '/api/v1/shares/nope/decline')).status).toBe(404);
  });
});
