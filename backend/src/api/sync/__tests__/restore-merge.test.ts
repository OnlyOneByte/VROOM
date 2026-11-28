import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await ctx.authed('POST', path, body);
  const data = await json<DataEnvelope<T>>(res);
  expect(res.status, `${path}: ${JSON.stringify(data)}`).toBeLessThan(300);
  return data.data;
}

const createCar = (licensePlate: string) =>
  post<{ id: string }>('/api/v1/vehicles', {
    make: 'Honda',
    model: 'Fit',
    year: 2018,
    licensePlate,
  });

const createExpense = (vehicleId: string, expenseAmount: number) =>
  post<{ id: string }>('/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount,
    date: '2024-03-01T00:00:00.000Z',
  });

const count = async (sql: string, ...params: string[]): Promise<number> =>
  ((await ctx.sql.get(sql, [...params])) as { n: number }).n;

async function exportZip(): Promise<Buffer> {
  const { backupService } = await import('../backup');
  return backupService.exportAsZip(ctx.user.id);
}

async function restore(zip: Buffer, mode: 'merge' | 'replace' | 'preview') {
  const { restoreService } = await import('../restore');
  return restoreService.restoreFromBackup(ctx.user.id, zip, mode);
}

describe('restore merge', () => {
  test('with nothing in the way, a deleted car comes back with its records and newer data stays', async () => {
    const car = await createCar('OLD-1');
    await createExpense(car.id, 40);
    await createExpense(car.id, 60);
    const zip = await exportZip();
    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${car.id}`)).status).toBeLessThan(300);
    const newer = await createCar('NEW-1');
    await createExpense(newer.id, 25);

    const result = await restore(zip, 'merge');

    expect(result.success).toBe(true);
    expect(result.imported?.vehicles).toBe(1);
    expect(result.imported?.expenses).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM vehicles WHERE user_id = ?', ctx.user.id)).toBe(
      2
    );
    expect(await count('SELECT COUNT(*) AS n FROM expenses WHERE user_id = ?', ctx.user.id)).toBe(
      3
    );
  });

  test('a backup car whose plate is on another car here is skipped with its records', async () => {
    const car = await createCar('SAME-1');
    await createExpense(car.id, 40);
    const zip = await exportZip();
    expect((await ctx.authed('DELETE', `/api/v1/vehicles/${car.id}`)).status).toBeLessThan(300);
    const replacement = await createCar('SAME-1');

    const result = await restore(zip, 'merge');

    expect(result.success).toBe(true);
    expect(result.imported?.vehicles).toBe(0);
    expect(result.kept?.vehicles).toBe(1);
    expect(result.imported?.expenses, 'its expense has no car to go on').toBe(0);
    expect(result.kept?.expenses).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM vehicles WHERE user_id = ?', ctx.user.id)).toBe(
      1
    );
    expect(
      await count('SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id = ?', replacement.id)
    ).toBe(0);
  });

  test('preview reports what a merge would add and keep, and writes nothing', async () => {
    const car = await createCar('PRE-1');
    await createExpense(car.id, 40);
    const gone = await createExpense(car.id, 60);
    const zip = await exportZip();
    await ctx.sql.run('DELETE FROM expenses WHERE id = ?', [gone.id]);

    const result = await restore(zip, 'preview');

    expect(result.success).toBe(true);
    expect(result.preview?.expenses).toBe(2);
    expect(result.merge?.imported.expenses).toBe(1);
    expect(result.merge?.kept.expenses).toBe(1);
    expect(result.merge?.kept.vehicles).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM expenses WHERE id = ?', gone.id)).toBe(0);
  });

  test('a merge keeps per-person permissions and the sharee role as they are', async () => {
    const car = await createCar('SHR-1');
    const invitee = await createInvitee(ctx, 'merge-sharee', 'Sharee');
    const share = await post<{ id: string }>('/api/v1/shares', {
      vehicleId: car.id,
      email: invitee.email,
      level: 'editor',
    });
    expect((await invitee.request('POST', `/api/v1/shares/${share.id}/accept`)).status).toBe(200);
    await ctx.sql.run(
      "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect) VALUES ('po-1', ?, 'vehicle', ?, 'vehicle.expense.read', 'deny')",
      [invitee.id, car.id]
    );
    const gone = await createExpense(car.id, 40);
    const zip = await exportZip();
    await ctx.sql.run('DELETE FROM expenses WHERE id = ?', [gone.id]);
    const rolesBefore = await ctx.sql.all(
      'SELECT id, role_id FROM role_assignments WHERE user_id = ? ORDER BY id',
      [invitee.id]
    );

    const result = await restore(zip, 'merge');

    expect(result.success).toBe(true);
    expect(result.imported?.expenses).toBe(1);
    expect(result.kept?.vehicleShares).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM permission_overrides WHERE id = 'po-1'")).toBe(1);
    expect(
      await ctx.sql.all('SELECT id, role_id FROM role_assignments WHERE user_id = ? ORDER BY id', [
        invitee.id,
      ]),
      "the sharee's role is not reset"
    ).toEqual(rolesBefore);
  });
});
