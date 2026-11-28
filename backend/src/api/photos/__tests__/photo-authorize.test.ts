import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'photo-car';

async function photo(id: string, createdBy: string | null, entityType = 'vehicle', entityId = CAR) {
  await ctx.sql.run(
    "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, created_by) VALUES (?, ?, ?, ?, 'a.jpg', 'image/jpeg', 10, ?)",
    [id, ctx.user.id, entityType, entityId, createdBy]
  );
}

const list = (request: RequestFn) =>
  request('GET', `/api/v1/vehicles/${CAR}/photos`).then((res) => res.status);
const remove = (request: RequestFn, id: string) =>
  request('DELETE', `/api/v1/vehicles/${CAR}/photos/${id}`).then((res) => res.status);

async function upload(cookie: string, path: string): Promise<number> {
  const form = new FormData();
  form.append('photo', new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }));
  const res = await ctx.app.request(path, {
    method: 'POST',
    body: form,
    headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
  });
  return res.status;
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'photo');
  await photo('owners-photo', null);
  await photo('editors-photo', m.editor.id);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('photos resolve through can() for every role', () => {
  test('reads: viewers now see vehicle photos; strangers 404; a disabled member 403', async () => {
    for (const request of [ctx.authed, m.coOwner.request, m.editor.request, m.viewer.request]) {
      expect(await list(request)).toBe(200);
    }
    expect(await list(m.stranger.request)).toBe(404);
    expect(await list(m.disabled.request)).toBe(403);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.photo.read', 'deny');
    expect(await list(m.viewer.request)).toBe(403);
  });

  test('uploads: editors pass the gate, viewers only with an allow override', async () => {
    const path = `/api/v1/vehicles/${CAR}/photos`;
    expect(await upload(m.editor.cookie, path)).toBe(400);
    expect(await upload(m.viewer.cookie, path)).toBe(403);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.photo.write', 'allow');
    expect(await upload(m.viewer.cookie, path)).toBe(400);
    expect(await upload(m.stranger.cookie, path)).toBe(404);
  });

  test('deletes: editors only their own photos, co-owners any', async () => {
    expect(await remove(m.editor.request, 'owners-photo')).toBe(403);
    expect(await remove(m.editor.request, 'editors-photo')).toBe(204);
    expect(await remove(m.viewer.request, 'owners-photo')).toBe(403);
    expect(await remove(m.coOwner.request, 'owners-photo')).toBe(204);
  });

  test('receipts follow a deny on their expense or reading', async () => {
    await ctx.sql.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('exp-1', ?, ?, 'fuel', 1717200000, 100)",
      [CAR, ctx.user.id]
    );
    await ctx.sql.run(
      'INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES (?, ?, ?, 10, 1717200000)',
      ['odo-1', CAR, ctx.user.id]
    );
    await photo('receipt', null, 'expense', 'exp-1');
    await photo('dash', null, 'odometer_entry', 'odo-1');
    const reads = [
      '/api/v1/photos/expense/exp-1',
      '/api/v1/photos/expense/exp-1/receipt/thumbnail',
      '/api/v1/photos/odometer_entry/odo-1',
      '/api/v1/photos/odometer_entry/odo-1/dash/thumbnail',
    ];
    expect((await m.viewer.request('GET', reads[0] ?? '')).status).toBe(200);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.expense.read', 'deny');
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.odometer.read', 'deny');
    for (const path of reads) {
      expect((await m.viewer.request('GET', path)).status, path).toBe(403);
    }
  });

  test('a photo id from another car is not found under this car', async () => {
    await seedCar(ctx, 'other-car');
    await photo('other-cars-photo', null, 'vehicle', 'other-car');
    expect(await remove(m.editor.request, 'other-cars-photo')).toBe(404);
    expect(await remove(m.coOwner.request, 'other-cars-photo')).toBe(404);
  });

  test('policy documents stay with the policy owner', async () => {
    await ctx.sql.run(
      "INSERT INTO insurance_policies (id, user_id, company) VALUES ('pol-1', ?, 'Mutual')",
      [ctx.user.id]
    );
    await photo('policy-photo', null, 'insurance_policy', 'pol-1');
    const path = '/api/v1/photos/insurance_policy/pol-1';
    expect((await ctx.authed('GET', path)).status).toBe(200);
    expect((await m.coOwner.request('GET', path)).status).toBe(404);
    expect((await m.stranger.request('GET', path)).status).toBe(404);
    expect((await ctx.authed('GET', '/api/v1/photos/unknown_type/x')).status).toBe(400);
  });

  test("another person's photos stay theirs", async () => {
    await seedCar(ctx, 'their-car', m.stranger.id);
    expect((await ctx.authed('GET', '/api/v1/vehicles/their-car/photos')).status).toBe(404);
    const grouped = await m.stranger.request('GET', '/api/v1/photos?entityType=vehicle');
    const body = (await grouped.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data)).not.toContain(CAR);
  });
});
