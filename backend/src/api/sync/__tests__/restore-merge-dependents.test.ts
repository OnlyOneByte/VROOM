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

const count = (sql: string, ...params: string[]): number =>
  (ctx.sqlite.query(sql).get(...params) as { n: number }).n;

async function exportZip(): Promise<Buffer> {
  const { backupService } = await import('../backup');
  return backupService.exportAsZip(ctx.user.id);
}

async function retag(zip: Buffer, from: string, to: string): Promise<Buffer> {
  const AdmZip = (await import('adm-zip')).default;
  const archive = new AdmZip(zip);
  for (const entry of archive.getEntries()) {
    if (!entry.entryName.endsWith('.csv')) continue;
    const csv = entry.getData().toString('utf-8');
    archive.updateFile(entry.entryName, Buffer.from(csv.split(from).join(to)));
  }
  return archive.toBuffer();
}

async function merge(zip: Buffer) {
  const { restoreService } = await import('../restore');
  return restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');
}

function insertExpense(id: string, vehicleId: string, userId: string, driverId: string | null) {
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, missed_fillup, paid_by_driver_id)
     VALUES (?, ?, ?, 'fuel', 1600000000, 2500, 0, ?)`,
    [id, vehicleId, userId, driverId]
  );
}

describe('restore merge with records that depend on other records', () => {
  test('a car taken off a reminder after the backup stays off it', async () => {
    const kept = await createCar('REM-1');
    const removed = await createCar('REM-2');
    const reminder = await post<{ reminder: { id: string } }>('/api/v1/reminders', {
      name: 'Tyre check',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-02-01T00:00:00.000Z',
      vehicleIds: [kept.id, removed.id],
    });
    const reminderId = reminder.reminder.id;
    const zip = await exportZip();
    ctx.sqlite.run('DELETE FROM reminder_vehicles WHERE reminder_id = ? AND vehicle_id = ?', [
      reminderId,
      removed.id,
    ]);

    const result = await merge(zip);

    expect(result.imported?.reminderVehicles).toBe(0);
    const links = ctx.sqlite
      .query('SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = ?')
      .all(reminderId);
    expect(links).toEqual([{ vehicle_id: kept.id }]);
  });

  test("an expense naming another account's driver is not added", async () => {
    const car = await createCar('DRV-1');
    ctx.sqlite.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, name) VALUES ('my-driver', ?, 'Me')",
      [car.id]
    );
    insertExpense('my-expense', car.id, ctx.user.id, 'my-driver');
    const zip = await retag(await exportZip(), 'my-driver', 'their-driver');
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('them', 't@test.com', 'T')"
    );
    ctx.sqlite.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('their-car', 'them', 'Kia', 'Rio', 2020)"
    );
    ctx.sqlite.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, name) VALUES ('their-driver', 'their-car', 'T')"
    );
    ctx.sqlite.run("DELETE FROM expenses WHERE id = 'my-expense'");

    const result = await merge(zip);

    expect(result.success).toBe(true);
    expect(result.imported?.expenses).toBe(0);
    expect(
      count("SELECT COUNT(*) AS n FROM expenses WHERE paid_by_driver_id = 'their-driver'")
    ).toBe(0);
  });

  test('records in the backup for a car shared with you are not added to it', async () => {
    const mine = await createCar('SHW-1');
    insertExpense('my-expense', mine.id, ctx.user.id, null);
    const owner = await createInvitee(ctx, 'car-owner', 'Owner');
    const created = await owner.request('POST', '/api/v1/vehicles', {
      make: 'Mazda',
      model: '3',
      year: 2019,
    });
    const theirCar = (await json<DataEnvelope<{ id: string }>>(created)).data.id;
    const invite = await owner.request('POST', '/api/v1/shares', {
      vehicleId: theirCar,
      email: ctx.user.email,
      level: 'editor',
    });
    const shareId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
    expect((await ctx.authed('POST', `/api/v1/shares/${shareId}/accept`)).status).toBe(200);
    const zip = await retag(await exportZip(), mine.id, theirCar);
    ctx.sqlite.run("DELETE FROM expenses WHERE id = 'my-expense'");

    const result = await merge(zip);

    expect(result.imported?.vehicles).toBe(0);
    expect(result.imported?.expenses).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id = ?', theirCar)).toBe(0);
    expect(
      count('SELECT COUNT(*) AS n FROM vehicles WHERE id = ? AND user_id = ?', theirCar, owner.id)
    ).toBe(1);
  });
});
