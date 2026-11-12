import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { uploadPhotoForEntity } from '../photo-service';
import { type FakePhotoStorage, installFakePhotoStorage } from './fake-photo-storage';

let ctx: TestApp;
let storage: FakePhotoStorage;
let photoId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-1', ?, 'Toyota', 'Camry', 2022)`,
    [ctx.user.id]
  );
  storage = installFakePhotoStorage(ctx);
  const photo = await uploadPhotoForEntity(
    'vehicle',
    'veh-1',
    ctx.user.id,
    new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })
  );
  photoId = photo.id;
});

afterEach(() => {
  storage.restore();
  ctx.close();
});

async function serve(path: string): Promise<Response> {
  return ctx.app.request(path, { headers: { Cookie: ctx.cookie } });
}

describe('photo serve security headers', () => {
  test('the generic thumbnail route sends nosniff and the stored MIME type', async () => {
    const res = await serve(`/api/v1/photos/vehicle/veh-1/${photoId}/thumbnail`);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  test('the vehicle-scoped thumbnail route sends nosniff and the stored MIME type', async () => {
    const res = await serve(`/api/v1/vehicles/veh-1/photos/${photoId}/thumbnail`);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });
});
