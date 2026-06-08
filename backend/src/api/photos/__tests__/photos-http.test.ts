/**
 * HTTP-level tests for GET /api/v1/photos?entityType= (the batch endpoint that
 * killed the dashboard's per-vehicle N+1). Repository/property tests already pin
 * the user/entity scoping; this proves the same behavior through the FULL route
 * stack — middleware → requireAuth → zValidator → handler → service → repo → DB —
 * which is exactly the layer those bypass.
 *
 * REGRESSION GUARD (STATUS gap #0): an earlier version of this file passed in
 * isolation but 500'd in the full `bun test` suite, because `sync-worker.test.ts`
 * used `mock.module('../../photos/photo-repository', ...)` — a process-global stub
 * that can't be restored, so it leaked a `photoRepository` missing `findByUser`
 * into every later file. That test was converted to dependency injection; this
 * file passing IN THE FULL SUITE is the proof the leak is gone. Keep it.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import type { Photo } from '../../../db/schema';

let ctx: TestApp;

/** Insert a photo row directly (no storage provider needed for a read test). */
function seedPhoto(
  sqlite: TestApp['sqlite'],
  opts: { id: string; userId: string; entityType: string; entityId: string; fileName?: string }
): void {
  sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [opts.id, opts.userId, opts.entityType, opts.entityId, opts.fileName ?? `${opts.id}.jpg`]
  );
}

beforeEach(async () => {
  ctx = await createTestApp();
});

describe('GET /api/v1/photos?entityType= (batch list)', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('GET', '/api/v1/photos?entityType=vehicle');
    expect(res.status).toBe(401);
  });

  test('400 when entityType is missing', async () => {
    const res = await ctx.authed('GET', '/api/v1/photos');
    expect(res.status).toBe(400);
  });

  test('groups the session user\'s vehicle photos by entityId', async () => {
    seedPhoto(ctx.sqlite, { id: 'p1', userId: ctx.user.id, entityType: 'vehicle', entityId: 'veh-1' });
    seedPhoto(ctx.sqlite, { id: 'p2', userId: ctx.user.id, entityType: 'vehicle', entityId: 'veh-1' });
    seedPhoto(ctx.sqlite, { id: 'p3', userId: ctx.user.id, entityType: 'vehicle', entityId: 'veh-2' });

    const res = await ctx.authed('GET', '/api/v1/photos?entityType=vehicle');
    expect(res.status).toBe(200);

    const body = await json<DataEnvelope<Record<string, Photo[]>>>(res);
    expect(Object.keys(body.data).sort()).toEqual(['veh-1', 'veh-2']);
    expect(body.data['veh-1']).toHaveLength(2);
    expect(body.data['veh-2']).toHaveLength(1);
  });

  test('never returns another user\'s photos', async () => {
    // The harness seeds the session user; create a second user to own foreign photos.
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('other-user', 'other@test.com', 'Other')`
    );
    seedPhoto(ctx.sqlite, { id: 'mine', userId: ctx.user.id, entityType: 'vehicle', entityId: 'veh-mine' });
    seedPhoto(ctx.sqlite, {
      id: 'theirs',
      userId: 'other-user',
      entityType: 'vehicle',
      entityId: 'veh-theirs',
    });

    const res = await ctx.authed('GET', '/api/v1/photos?entityType=vehicle');
    expect(res.status).toBe(200);

    const body = await json<DataEnvelope<Record<string, Photo[]>>>(res);
    expect(Object.keys(body.data)).toEqual(['veh-mine']);
    expect(body.data['veh-theirs']).toBeUndefined();
  });

  test('filters by entity type — expense photos excluded from a vehicle batch', async () => {
    seedPhoto(ctx.sqlite, { id: 'veh', userId: ctx.user.id, entityType: 'vehicle', entityId: 'veh-1' });
    seedPhoto(ctx.sqlite, { id: 'exp', userId: ctx.user.id, entityType: 'expense', entityId: 'exp-1' });

    const res = await ctx.authed('GET', '/api/v1/photos?entityType=vehicle');
    expect(res.status).toBe(200);

    const body = await json<DataEnvelope<Record<string, Photo[]>>>(res);
    expect(Object.keys(body.data)).toEqual(['veh-1']);
    expect(body.data['exp-1']).toBeUndefined();
  });

  test('returns an empty object when the user has no photos of that type', async () => {
    const res = await ctx.authed('GET', '/api/v1/photos?entityType=vehicle');
    expect(res.status).toBe(200);

    const body = await json<DataEnvelope<Record<string, Photo[]>>>(res);
    expect(body.data).toEqual({});
  });
});
