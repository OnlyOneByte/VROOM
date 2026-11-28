import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function createVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge: the settings already here win', () => {
  test('brings back a deleted car and keeps the current settings row unchanged', async () => {
    const myVehicleId = await createVehicle('Honda');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const delRes = await ctx.authed('DELETE', `/api/v1/vehicles/${myVehicleId}`);
    expect(delRes.status).toBeLessThan(300);
    await ctx.sql.run(
      "UPDATE user_preferences SET theme_preference = 'midnight' WHERE user_id = ?",
      [ctx.user.id]
    );

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');

    expect(result.success).toBe(true);
    expect(result.imported?.vehicles).toBe(1);
    expect(result.imported?.userPreferences).toBe(0);
    expect(result.kept?.userPreferences).toBe(1);
    const back = await ctx.sql.all('SELECT id FROM vehicles WHERE id = ?', [myVehicleId]);
    expect(back).toHaveLength(1);
    const prefs = (await ctx.sql.get(
      'SELECT theme_preference FROM user_preferences WHERE user_id = ?',
      [ctx.user.id]
    )) as { theme_preference: string };
    expect(prefs.theme_preference).toBe('midnight');
  });
});
