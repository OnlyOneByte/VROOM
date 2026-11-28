import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
  for (const id of ['prov-a', 'prov-b']) {
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES (?, ?, 'storage', 'fake', ?, 'x', 'active')`,
      [id, ctx.user.id, id]
    );
  }
  await ctx.sql.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-d', ?, 'Fiat', '500', 2019)`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-d', ?, 'vehicle', 'veh-d', 'a.jpg', 'image/jpeg', 1)`,
    [ctx.user.id]
  );
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function addRef(id: string, providerId: string, status = 'active'): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
     VALUES (?, 'photo-d', ?, 'file', ?)`,
    [id, providerId, status]
  );
}

const providerIds = async (): Promise<string[]> =>
  ((await ctx.sql.all('SELECT id FROM user_providers ORDER BY id')) as { id: string }[]).map(
    (r) => r.id
  );

describe('deleting a storage provider that holds the only copy of photos', () => {
  test('is refused with the count unless forced', async () => {
    await addRef('ref-a', 'prov-a');
    const res = await ctx.authed('DELETE', '/api/v1/providers/prov-a');
    expect(res.status).toBe(409);
    const body = await json<{ error: { message: string; details: { photosOnlyHere: number } } }>(
      res
    );
    expect(body.error.details.photosOnlyHere).toBe(1);
    expect(body.error.message).toContain('1 photo is stored only in this storage');
    expect(await providerIds()).toEqual(['prov-a', 'prov-b']);
    expect(await ctx.sql.all('SELECT id FROM photo_refs')).toEqual([{ id: 'ref-a' }]);
  });

  test('goes ahead with force=true', async () => {
    await addRef('ref-a', 'prov-a');
    const res = await ctx.authed('DELETE', '/api/v1/providers/prov-a?force=true');
    expect(res.status).toBe(204);
    expect(await providerIds()).toEqual(['prov-b']);
  });

  test('goes ahead without force when another provider has an active copy', async () => {
    await addRef('ref-a', 'prov-a');
    await addRef('ref-b', 'prov-b');
    const res = await ctx.authed('DELETE', '/api/v1/providers/prov-a');
    expect(res.status).toBe(204);
  });

  test('goes ahead without force when the other copy is not active yet', async () => {
    await addRef('ref-a', 'prov-a', 'pending');
    const res = await ctx.authed('DELETE', '/api/v1/providers/prov-a');
    expect(res.status).toBe(204);
  });

  test('counts a pending copy elsewhere as no copy', async () => {
    await addRef('ref-a', 'prov-a');
    await addRef('ref-b', 'prov-b', 'pending');
    const res = await ctx.authed('DELETE', '/api/v1/providers/prov-a');
    expect(res.status).toBe(409);
  });
});
