import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let asB: RequestFn;
let bCookie: string;
let bEmail: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const b = await createInvitee(ctx, 'photo-sharee', 'Sharee B');
  bEmail = b.email;
  bCookie = b.cookie;
  asB = b.request;
});
afterEach(() => ctx.close());

async function uploadAsB(entityType: string, entityId: string): Promise<Response> {
  const form = new FormData();
  form.append(
    'photo',
    new File([new Uint8Array([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' })
  );
  return ctx.app.request(`/api/v1/photos/${entityType}/${entityId}`, {
    method: 'POST',
    headers: { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' },
    body: form,
  });
}

async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteBody = await json<DataEnvelope<{ id: string }>>(invite);
  expect(invite.status, JSON.stringify(inviteBody)).toBe(201);
  const accepted = await asB('POST', `/api/v1/shares/${inviteBody.data.id}/accept`);
  expect(accepted.status, 'B accepts the invite').toBe(200);
  return vehicleId;
}

async function expenseByB(vehicleId: string): Promise<string> {
  const res = await asB('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 50,
    date: '2024-06-01T00:00:00.000Z',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  const row = ctx.sqlite.query('SELECT user_id FROM expenses WHERE id = ?').get(body.data.id) as {
    user_id: string;
  };
  expect(row.user_id).toBe(ctx.user.id);
  return body.data.id;
}

describe('photo access on owner-stamped rows of a shared vehicle', () => {
  test('an EDITOR can list the photos of an expense they logged on a shared vehicle', async () => {
    const vehicleId = await shareAccepted('editor');
    const expenseId = await expenseByB(vehicleId);

    const res = await asB('GET', `/api/v1/photos/expense/${expenseId}`);
    expect(res.status, 'the editor must reach the receipt list of their own expense').toBe(200);
    const body = await json<DataEnvelope<unknown[]>>(res);
    expect(body.data).toHaveLength(0);
  });

  test('an EDITOR passes the upload gate for that expense (fails later, on storage config only)', async () => {
    const vehicleId = await shareAccepted('editor');
    const expenseId = await expenseByB(vehicleId);

    const res = await uploadAsB('expense', expenseId);
    expect(res.status, 'authorization must not be the thing that rejects the editor').not.toBe(404);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? '').toContain('No storage provider configured');
  });

  test('an EDITOR can list the photos of an odometer reading they logged', async () => {
    const vehicleId = await shareAccepted('editor');
    const created = await asB('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 51000,
      recordedAt: '2024-06-02T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);

    const res = await asB('GET', `/api/v1/photos/odometer_entry/${body.data.id}`);
    expect(res.status, 'odometer readings are owner-stamped the same way').toBe(200);
  });

  test('a VIEWER is still denied both the read and the write (existence-hiding 404)', async () => {
    const vehicleId = await shareAccepted('viewer');
    const own = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 25,
      date: '2024-06-03T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(own)).data.id;

    expect((await asB('GET', `/api/v1/photos/expense/${expenseId}`)).status).toBe(404);
    expect((await uploadAsB('expense', expenseId)).status).toBe(404);
  });

  test('a user with NO share is denied (the widening is per-vehicle, not a blanket grant)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Private', model: 'Car', year: 2020 });
    const own = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 25,
      date: '2024-06-04T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(own)).data.id;

    expect((await asB('GET', `/api/v1/photos/expense/${expenseId}`)).status).toBe(404);
    expect((await uploadAsB('expense', expenseId)).status).toBe(404);
  });

  test('the owner still reaches their own rows on an unshared vehicle', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Solo', model: 'Car', year: 2019 });
    const own = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 10,
      date: '2024-06-05T00:00:00.000Z',
    });
    const expenseId = (await json<DataEnvelope<{ id: string }>>(own)).data.id;
    expect((await ctx.authed('GET', `/api/v1/photos/expense/${expenseId}`)).status).toBe(200);
  });
});
