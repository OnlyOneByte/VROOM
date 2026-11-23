import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import {
  type FakePhotoStorage,
  installFakePhotoStorage,
} from '../api/photos/__tests__/fake-photo-storage';
import { uploadPhotoForEntity } from '../api/photos/photo-service';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
  for (let i = 0; i < 30; i++) {
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)`,
      [`veh-${i}`, ctx.user.id]
    );
  }
});

afterEach(() => ctx.close());

async function get(path: string, acceptEncoding?: string): Promise<Response> {
  const headers: Record<string, string> = { Cookie: ctx.cookie };
  if (acceptEncoding) headers['Accept-Encoding'] = acceptEncoding;
  return ctx.app.request(path, { headers });
}

describe('API response compression', () => {
  test('gzips a JSON response when the client accepts gzip', async () => {
    const res = await get('/api/v1/vehicles', 'gzip, deflate, br');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Encoding')).toBe('gzip');
    expect(res.headers.get('Vary')).toContain('Accept-Encoding');
    const body = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
    expect(body.data).toHaveLength(30);
  });

  test('sends JSON as it is when the client sends no Accept-Encoding', async () => {
    const res = await get('/api/v1/vehicles');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Encoding')).toBeNull();
    expect((await json<DataEnvelope<unknown[]>>(res)).data).toHaveLength(30);
  });

  test('leaves the backup ZIP download uncompressed', async () => {
    const res = await get('/api/v1/sync/backups/download', 'gzip');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(Number(res.headers.get('Content-Length'))).toBeGreaterThan(1024);
    expect(res.headers.get('Content-Encoding')).toBeNull();
  });

  describe('photo thumbnails', () => {
    let storage: FakePhotoStorage;

    beforeEach(() => {
      storage = installFakePhotoStorage(ctx);
    });

    afterEach(() => storage.restore());

    test('leaves a thumbnail uncompressed', async () => {
      const photo = await uploadPhotoForEntity(
        'vehicle',
        'veh-0',
        ctx.user.id,
        new File([new Uint8Array(4096).fill(7)], 'shot.png', { type: 'image/png' })
      );

      const res = await get(`/api/v1/photos/vehicle/veh-0/${photo.id}/thumbnail`, 'gzip');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Content-Encoding')).toBeNull();
      expect((await res.arrayBuffer()).byteLength).toBe(4096);
    });
  });
});
