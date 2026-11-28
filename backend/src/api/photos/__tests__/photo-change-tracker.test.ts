import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { activityTracker } from '../../sync/activity-tracker';

let ctx: TestApp;
let markSpy: ReturnType<typeof spyOn<typeof activityTracker, 'markDataChanged'>> | undefined;

beforeEach(async () => {
  ctx = await createTestApp();
  await ctx.sql.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-1', ?, 'Toyota', 'Camry', 2022)`,
    [ctx.user.id]
  );
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-1', ?, 'vehicle', 'veh-1', 'shot.jpg', 'image/jpeg', 1024)`,
    [ctx.user.id]
  );
  markSpy = spyOn(activityTracker, 'markDataChanged').mockResolvedValue(undefined);
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  markSpy?.mockRestore();
  ctx.close();
});

describe('photo routes mark data changed on successful mutations', () => {
  test('a successful photo delete marks the user data changed', async () => {
    const res = await ctx.authed('DELETE', '/api/v1/photos/vehicle/veh-1/photo-1');

    expect(res.status).toBe(204);
    expect(markSpy).toHaveBeenCalledWith(ctx.user.id);
  });

  test('a read does not mark data changed', async () => {
    const res = await ctx.authed('GET', '/api/v1/photos/vehicle/veh-1');

    expect(res.status).toBe(200);
    expect(markSpy).not.toHaveBeenCalled();
  });

  test('a failed delete does not mark data changed', async () => {
    const res = await ctx.authed('DELETE', '/api/v1/photos/vehicle/veh-1/no-such-photo');

    expect(res.status).toBe(404);
    expect(markSpy).not.toHaveBeenCalled();
  });
});
