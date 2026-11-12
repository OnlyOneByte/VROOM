// createTestApp() must run before any DB-bound import: import only the harness and bun:test.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function seedPhoto(opts: {
  id: string;
  vehicleId: string;
  isCover?: boolean;
  sortOrder?: number;
}): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, is_cover, sort_order)
     VALUES (?, ?, 'vehicle', ?, ?, 'image/jpeg', 1024, ?, ?)`,
    [
      opts.id,
      ctx.user.id,
      opts.vehicleId,
      `${opts.id}.jpg`,
      opts.isCover ? 1 : 0,
      opts.sortOrder ?? 0,
    ]
  );
}

interface PhotoRow {
  id: string;
  isCover: boolean;
}

function coverFlag(photoId: string): number {
  return (
    ctx.sqlite.query('SELECT is_cover FROM photos WHERE id = ?').get(photoId) as {
      is_cover: number;
    }
  ).is_cover;
}

describe('GET /api/v1/vehicles/:vehicleId/photos (list)', () => {
  test('returns the vehicle’s photos in a paginated envelope', async () => {
    const vid = await seedVehicle(ctx, { nickname: 'Listed' });
    seedPhoto({ id: 'vp1', vehicleId: vid, isCover: true, sortOrder: 0 });
    seedPhoto({ id: 'vp2', vehicleId: vid, sortOrder: 1 });

    const res = await ctx.authed('GET', `/api/v1/vehicles/${vid}/photos`);
    const body = await json<{
      success: boolean;
      data: PhotoRow[];
      pagination: { totalCount: number };
    }>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.pagination.totalCount).toBe(2);
    expect(body.data.map((p) => p.id).sort()).toEqual(['vp1', 'vp2']);
  });

  test('a foreign vehicle returns 404', async () => {
    const res = await ctx.authed('GET', '/api/v1/vehicles/not-my-vehicle/photos');
    expect(res.status).toBe(404);
  });

  test('401 without a session', async () => {
    const res = await ctx.anon('GET', '/api/v1/vehicles/any/photos');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/vehicles/:vehicleId/photos/:photoId/cover (set cover)', () => {
  test('flips the target to cover and clears the previous cover', async () => {
    const vid = await seedVehicle(ctx, { nickname: 'Cover' });
    seedPhoto({ id: 'c1', vehicleId: vid, isCover: true });
    seedPhoto({ id: 'c2', vehicleId: vid, isCover: false });

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vid}/photos/c2/cover`);
    const body = await json<DataEnvelope<PhotoRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.isCover).toBe(true);

    expect(coverFlag('c2')).toBe(1);
    expect(coverFlag('c1')).toBe(0);
  });

  test('a photo belonging to another vehicle returns 404 through this vehicle URL', async () => {
    const vid = await seedVehicle(ctx, { nickname: 'Mine' });
    const otherVid = await seedVehicle(ctx, { nickname: 'Other' });
    seedPhoto({ id: 'mine-1', vehicleId: vid });
    seedPhoto({ id: 'other-1', vehicleId: otherVid });

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vid}/photos/other-1/cover`);
    expect(res.status).toBe(404);
    expect(coverFlag('other-1')).toBe(0);
  });

  test('set-cover on a foreign vehicle returns 404', async () => {
    const res = await ctx.authed('PUT', '/api/v1/vehicles/not-mine/photos/whatever/cover');
    expect(res.status).toBe(404);
  });
});
