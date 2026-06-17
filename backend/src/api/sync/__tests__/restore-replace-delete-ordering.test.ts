/**
 * CERTIFICATION + GUARD (C13, deep-review): a replace-mode restore wipes the importer's data
 * (deleteUserData) and then re-inserts the backup (insertBackupData) — both must respect the FK graph,
 * which the DB enforces (connection.ts: PRAGMA foreign_keys = ON). bun-sqlite's async-transaction
 * callback does NOT roll back a throw (the C151/#127 footgun), so an FK violation MID-restore corrupts
 * the account: NORTH_STAR #1 silent total loss.
 *
 * VERIFIED FIRSTHAND which side is load-bearing: the child FKs are `onDelete: cascade`, so the WIPE order
 * is defensively redundant (deleting a parent cascades its children — no throw). The teeth are on the
 * INSERT order in insertBackupData — a parent (vehicles) MUST be inserted before its children (financing/
 * odometer/expense/insurance/reminder rows that FK-reference it). Relocating the financing insert before
 * the vehicles insert turns this guard RED (FK violation), confirming it's non-vacuous on the real
 * constraint.
 *
 * The existing roundtrip tests each seed ONE entity family; unified-restore replace-restores an empty
 * backup. NONE seed a COMPLETE FK-linked dataset (vehicle + financing + odometer + expense + insurance
 * policy/term/junction/claim + reminder/junction/notification + photo + prefs/syncState) and then
 * replace-restore — which is what exercises the full wipe+reinsert ordering under real FK pressure. This
 * does. It certifies the current order CLEAN and is the merge-surviving guard: a future schema change
 * adding an FK the insert order violates (or a re-order regression) makes the restore throw → this RED.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports to the harness
 * + bun:test; import backup/restore dynamically AFTER createTestApp.
 */

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

/** Count helper over the importer's own rows. */
function count(sql: string): number {
  return (ctx.sqlite.query(sql).get() as { n: number }).n;
}

/**
 * Seed a COMPLETE FK-linked dataset owned by the importing user, spanning every table deleteUserData
 * touches (directly or via cascade). Returns nothing — the test reads counts back.
 */
async function seedFullDataset(): Promise<void> {
  const uid = ctx.user.id;

  // Vehicle (via the real API).
  const vehRes = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Subaru',
    model: 'Outback',
    year: 2022,
  });
  const veh = await json<DataEnvelope<{ id: string }>>(vehRes);
  expect(vehRes.status, JSON.stringify(veh)).toBeLessThan(300);
  const vehicleId = veh.data.id;

  // Financing on the vehicle (FK → vehicles).
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

  // An expense (FK → vehicles, user_id).
  const expRes = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 120.5,
    date: '2024-03-01T00:00:00.000Z',
  });
  expect(expRes.status, await expRes.clone().text()).toBe(201);

  // An odometer entry (FK → vehicles, user_id) — seed directly (mirrors entity-ownership-gate.test.ts).
  ctx.sqlite.run(
    `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
     VALUES ('odo-full-1', ?, ?, 45000, 1709251200)`,
    [vehicleId, uid]
  );

  // Insurance policy + term + term-vehicle junction + claim (FK chain → policies → terms/vehicles).
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

  // A reminder + its vehicle junction + a notification (FK → reminders/vehicles/user_id).
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

  // A photo on the vehicle (FK → user_id; entity link is by string, not FK).
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('photo-full-1', ?, 'vehicle', ?, 'car.jpg', 'image/jpeg', 4096)`,
    [uid, vehicleId]
  );

  // userPreferences + syncState are PK'd by userId; the app creates a prefs row on first use, but
  // ensure both exist so the wipe must clear them too.
  ctx.sqlite.run(`INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)`, [uid]);
  ctx.sqlite.run(`INSERT OR IGNORE INTO sync_state (user_id) VALUES (?)`, [uid]);
}

describe('replace-mode restore: FK-safe deleteUserData ordering on a COMPLETE dataset (C13)', () => {
  test('a full FK-linked dataset replace-restores cleanly (the wipe order survives FK enforcement)', async () => {
    await seedFullDataset();

    // Snapshot every table's row count BEFORE the round-trip (a vacuous guard would seed nothing).
    // NOTE: a costed insurance term auto-materializes a split premium expense (the insurance hook), so
    // `expenses` is 2 (manual + premium), not 1 — assert against the SNAPSHOT, not a hardcoded number,
    // so the guard tracks real behavior and only fails on actual loss/duplication.
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
    // Sanity: the core graph really is populated.
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

    // The crux: replace-mode runs deleteUserData (FK-ordered wipe) THEN re-inserts. With FKs enforced
    // (PRAGMA foreign_keys=ON) a wrong delete order throws here; the C151 footgun means a throw mid-wipe
    // would corrupt the account. Success proves the order is FK-safe across the whole graph.
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Every table round-tripped to its EXACT pre-restore count (wipe dropped nothing, re-insert restored
    // it all, no duplication) — the strongest single assertion that the wipe+reinsert is loss-free.
    for (const t of TABLES) {
      expect(
        count(`SELECT COUNT(*) n FROM ${t}`),
        `${t} round-tripped to its pre-restore count`
      ).toBe(before[t]);
    }
  });

  test('replacing TWICE in a row is idempotent — the second wipe+restore also succeeds', async () => {
    // A second replace exercises deleteUserData against the ALREADY-restored full graph (not just the
    // originally-seeded one), so the FK-ordered wipe is proven against restored rows too.
    await seedFullDataset();
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const first = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(first.success, JSON.stringify(first)).toBe(true);

    const zip2 = await backupService.exportAsZip(ctx.user.id);
    const second = await restoreService.restoreFromBackup(ctx.user.id, zip2, 'replace');
    expect(second.success, JSON.stringify(second)).toBe(true);

    // Still exactly one of each — no duplication, no loss across the double round-trip.
    expect(count('SELECT COUNT(*) n FROM vehicles')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM vehicle_financing')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM insurance_claims')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM photos')).toBe(1);
  });
});
