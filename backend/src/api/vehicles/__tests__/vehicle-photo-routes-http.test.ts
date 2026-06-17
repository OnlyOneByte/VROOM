/**
 * In-process HTTP tests for the vehicle-photo sub-router's DB-only endpoints (the file was 0%-covered,
 * C228 guard). The router (vehicles/photo-routes.ts) is mounted at /api/v1/vehicles/:vehicleId/photos
 * and inherits requireAuth + changeTracker from the parent. Upload + thumbnail need a real storage
 * provider (not in-harness-testable; the property tests model those), so this drives the provider-free
 * paths over the FULL route stack: LIST (GET /) and SET-COVER (PUT /:photoId/cover).
 *
 * Pins the load-bearing invariants: list is ownership-gated + paginated; set-cover enforces the
 * entityType/entityId match (a photo from another entity can't become this vehicle's cover) + the
 * single-cover guarantee; a foreign vehicle 404s (never leaks another tenant's photos). Photos are
 * raw-seeded (no provider needed for a DB read/flag-flip), the C215/C220 pattern.
 *
 * createTestApp() rewrites env + dynamic-imports the DB-bound modules, so this file imports only the
 * harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(nickname: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Subaru',
    model: 'Outback',
    year: 2021,
    nickname,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

/** Raw-insert a photo row (no storage provider needed for the DB-only list/cover paths). */
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
    const vid = await seedVehicle('Listed');
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

  test('a foreign vehicle 404s (ownership gate; no cross-tenant leak)', async () => {
    const res = await ctx.authed('GET', '/api/v1/vehicles/not-my-vehicle/photos');
    expect(res.status).toBe(404);
  });

  test('401 without a session', async () => {
    const res = await ctx.anon('GET', '/api/v1/vehicles/any/photos');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/vehicles/:vehicleId/photos/:photoId/cover (set cover)', () => {
  test('flips the target to cover and clears the previous cover (single-cover invariant)', async () => {
    const vid = await seedVehicle('Cover');
    seedPhoto({ id: 'c1', vehicleId: vid, isCover: true });
    seedPhoto({ id: 'c2', vehicleId: vid, isCover: false });

    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vid}/photos/c2/cover`);
    const body = await json<DataEnvelope<PhotoRow>>(res);
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.isCover).toBe(true);

    // The single-cover guarantee: c2 is now cover, c1 is not.
    expect(coverFlag('c2')).toBe(1);
    expect(coverFlag('c1')).toBe(0);
  });

  test('a photoId belonging to a DIFFERENT entity 404s (entityType/entityId match-check)', async () => {
    const vid = await seedVehicle('Mine');
    const otherVid = await seedVehicle('Other');
    seedPhoto({ id: 'mine-1', vehicleId: vid });
    seedPhoto({ id: 'other-1', vehicleId: otherVid });

    // Try to set the OTHER vehicle's photo as MINE's cover via my vehicle URL.
    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vid}/photos/other-1/cover`);
    expect(res.status).toBe(404);
    // The foreign photo's cover flag is untouched.
    expect(coverFlag('other-1')).toBe(0);
  });

  test('set-cover on a foreign vehicle 404s', async () => {
    const res = await ctx.authed('PUT', '/api/v1/vehicles/not-mine/photos/whatever/cover');
    expect(res.status).toBe(404);
  });
});
