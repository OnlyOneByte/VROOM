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

async function createExpense(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 80,
    date: '2024-03-01T00:00:00.000Z',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge stays inside the importing account', () => {
  test('a backup car whose id belongs to another account is skipped, and nothing is added to that car', async () => {
    const myVehicleId = await createVehicle('Honda');
    const myExpenseId = await createExpense(myVehicleId);
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;
    const zip = await backupService.exportAsZip(ctx.user.id);

    const db = (await import('../../../db/connection')).getDb();
    const schema = await import('../../../db/schema');
    const otherId = 'other-user-1';
    const otherVehicleId = 'other-vehicle-1';
    await db
      .insert(schema.users)
      .values({ id: otherId, email: 'other@test.com', displayName: 'O' });
    await db.insert(schema.vehicles).values({
      id: otherVehicleId,
      userId: otherId,
      make: 'Ferrari',
      model: 'F8',
      year: 2023,
    });

    const archive = new AdmZip(zip);
    for (const entry of archive.getEntries()) {
      if (!entry.entryName.endsWith('.csv')) continue;
      const csv = entry.getData().toString('utf-8');
      archive.updateFile(entry.entryName, Buffer.from(csv.split(myVehicleId).join(otherVehicleId)));
    }
    ctx.sqlite.run('DELETE FROM expenses WHERE id = ?', [myExpenseId]);

    const result = await restoreService.restoreFromBackup(ctx.user.id, archive.toBuffer(), 'merge');

    expect(result.success).toBe(true);
    expect(result.imported?.vehicles).toBe(0);
    expect(result.imported?.expenses, 'an expense on that car is not added').toBe(0);
    expect(result.kept?.vehicles).toBe(1);
    expect(JSON.stringify(result)).not.toContain('Ferrari');
    expect(JSON.stringify(result)).not.toContain(otherId);

    const otherCar = ctx.sqlite
      .query('SELECT user_id, make FROM vehicles WHERE id = ?')
      .all(otherVehicleId) as { user_id: string; make: string }[];
    expect(otherCar).toEqual([{ user_id: otherId, make: 'Ferrari' }]);
    const onOtherCar = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id = ?')
      .get(otherVehicleId) as { n: number };
    expect(onOtherCar.n).toBe(0);
  });

  test('merging a backup of exactly what is here adds nothing and keeps everything', async () => {
    const myVehicleId = await createVehicle('Toyota');
    await createExpense(myVehicleId);
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');

    expect(result.success).toBe(true);
    expect(Object.values(result.imported ?? {}).every((n) => n === 0)).toBe(true);
    expect(result.kept?.vehicles).toBe(1);
    expect(result.kept?.expenses).toBe(1);
  });
});
