import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function count(sql: string): number {
  return (ctx.sqlite.query(sql).get() as { n: number }).n;
}

async function seedFullDataset(): Promise<void> {
  const uid = ctx.user.id;

  const vehRes = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Subaru',
    model: 'Outback',
    year: 2022,
  });
  const veh = await json<DataEnvelope<{ id: string }>>(vehRes);
  expect(vehRes.status, JSON.stringify(veh)).toBeLessThan(300);
  const vehicleId = veh.data.id;

  const finRes = await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
    financingType: 'loan',
    provider: 'TestBank',
    originalAmount: 25000,
    termMonths: 60,
    startDate: '2024-01-01T00:00:00.000Z',
    paymentAmount: 450,
    apr: 5,
  });
  expect(finRes.status, await finRes.clone().text()).toBeLessThan(300);

  const expRes = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 120.5,
    date: '2024-03-01T00:00:00.000Z',
  });
  expect(expRes.status, await expRes.clone().text()).toBe(201);

  ctx.sqlite.run(
    `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
     VALUES ('odo-full-1', ?, ?, 45000, 1709251200)`,
    [vehicleId, uid]
  );

  const polRes = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T00:00:00.000Z',
        policyNumber: 'POL-FULL',
        totalCost: 1200,
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const pol = await json<DataEnvelope<{ id: string }>>(polRes);
  expect(polRes.status, JSON.stringify(pol)).toBe(201);
  const claimRes = await ctx.authed('POST', `/api/v1/insurance/${pol.data.id}/claims`, {
    claimDate: '2024-06-15T00:00:00.000Z',
    claimType: 'collision',
    vehicleId,
  });
  expect(claimRes.status, await claimRes.clone().text()).toBe(201);

  const remRes = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Registration renewal',
    type: 'notification',
    frequency: 'yearly',
    startDate: '2024-02-01T00:00:00.000Z',
    vehicleIds: [vehicleId],
  });
  const rem = await json<DataEnvelope<{ reminder: { id: string } }>>(remRes);
  expect(remRes.status, JSON.stringify(rem)).toBe(201);
  ctx.sqlite.run(
    `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
     VALUES ('notif-full-1', ?, ?, 1709251200, NULL, 0)`,
    [rem.data.reminder.id, uid]
  );

  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-full-1', ?, 'vehicle', ?, 'car.jpg', 'image/jpeg', 4096)`,
    [uid, vehicleId]
  );

  ctx.sqlite.run(`INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)`, [uid]);
  ctx.sqlite.run(`INSERT OR IGNORE INTO sync_state (user_id) VALUES (?)`, [uid]);
}

describe('replace-mode restore with a complete FK-linked dataset', () => {
  test('a full FK-linked dataset replace-restores cleanly', async () => {
    await seedFullDataset();

    const TABLES = [
      'vehicles',
      'vehicle_financing',
      'odometer_entries',
      'expenses',
      'insurance_policies',
      'insurance_terms',
      'insurance_term_vehicles',
      'insurance_claims',
      'reminders',
      'reminder_vehicles',
      'reminder_notifications',
      'photos',
    ] as const;
    const before: Record<string, number> = {};
    for (const t of TABLES) before[t] = count(`SELECT COUNT(*) n FROM ${t}`);
    expect(before.vehicles, 'a vehicle was seeded').toBe(1);
    expect(before.vehicle_financing, 'financing seeded').toBe(1);
    expect(before.odometer_entries, 'odometer seeded').toBe(1);
    expect(before.expenses, 'expense(s) seeded (manual + auto premium)').toBeGreaterThanOrEqual(1);
    expect(before.insurance_claims, 'claim seeded').toBe(1);
    expect(before.reminders, 'reminder seeded').toBe(1);
    expect(before.photos, 'photo seeded').toBe(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    for (const t of TABLES) {
      expect(
        count(`SELECT COUNT(*) n FROM ${t}`),
        `${t} round-tripped to its pre-restore count`
      ).toBe(before[t]);
    }
  });

  test('replacing twice in a row succeeds', async () => {
    await seedFullDataset();
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const first = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(first.success, JSON.stringify(first)).toBe(true);

    const zip2 = await backupService.exportAsZip(ctx.user.id);
    const second = await restoreService.restoreFromBackup(ctx.user.id, zip2, 'replace');
    expect(second.success, JSON.stringify(second)).toBe(true);

    expect(count('SELECT COUNT(*) n FROM vehicles')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM vehicle_financing')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM insurance_claims')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM photos')).toBe(1);
  });
});
