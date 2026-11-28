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

const count = (sql: string, ...params: string[]): number =>
  (ctx.sqlite.query(sql).get(...params) as { n: number }).n;

function expense(id: string, vehicleId: string, userId: string, groupId: string | null) {
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup, group_id)
     VALUES (?, ?, ?, 'fuel', 1600000000, 2500, 0, ?)`,
    [id, vehicleId, userId, groupId]
  );
}

function photo(id: string, entityId: string) {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, 'expense', ?, 'receipt.jpg', 'image/jpeg', 100)`,
    [id, ctx.user.id, entityId]
  );
}

describe('replace restore', () => {
  test('counts only what it adds, and leaves out records that depend on one it left out', async () => {
    const res = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Honda',
      model: 'Fit',
      year: 2018,
    });
    const carId = (await json<DataEnvelope<{ id: string }>>(res)).data.id;
    expense('kept-expense', carId, ctx.user.id, null);
    expense('left-out', carId, ctx.user.id, 'taken-group');
    photo('kept-photo', 'kept-expense');
    photo('left-out-photo', 'left-out');
    const { backupService } = await import('../backup');
    const zip = await backupService.exportAsZip(ctx.user.id);
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('them', 't@test.com', 'T')"
    );
    ctx.sqlite.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('their-car', 'them', 'Kia', 'Rio', 2020)"
    );
    expense('their-expense', 'their-car', 'them', 'taken-group');

    const { restoreService } = await import('../restore');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.imported?.expenses).toBe(1);
    expect(result.imported?.photos).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM photos WHERE id = 'left-out-photo'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM photos WHERE id = 'kept-photo'")).toBe(1);
  });
});
