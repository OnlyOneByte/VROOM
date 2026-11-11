// Money is stored as integer cents. Restoring a pre-2.0.0 dollar backup must scale its money to cents,
// and an unknown future version must be rejected rather than coerced.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Raw cents value of an expense, read straight from SQLite. */
function expenseAmountCents(id: string): number | undefined {
  const row = ctx.sqlite.query('SELECT expense_amount FROM expenses WHERE id = ?').get(id) as {
    expense_amount: number;
  } | null;
  return row?.expense_amount;
}

/** Builds a valid backup ZIP at the given version, with one vehicle and one expense. */
function buildBackupZip(version: string, expenseAmountCell: string): Buffer {
  const userId = ctx.user.id;
  const vehicleId = 'v_t2';
  const expenseId = 'e_t2';
  const zip = new AdmZip();
  zip.addFile(
    'metadata.json',
    Buffer.from(JSON.stringify({ version, timestamp: new Date(0).toISOString(), userId }), 'utf-8')
  );
  zip.addFile(
    'vehicles.csv',
    Buffer.from(
      `id,userId,make,model,year\n"${vehicleId}","${userId}","Toyota","Camry","2022"\n`,
      'utf-8'
    )
  );
  zip.addFile(
    'expenses.csv',
    Buffer.from(
      `id,vehicleId,userId,category,date,expenseAmount\n"${expenseId}","${vehicleId}","${userId}","fuel","${new Date(1700000000000).toISOString()}","${expenseAmountCell}"\n`,
      'utf-8'
    )
  );
  // Required files must be present, so empty ones are added.
  for (const f of ['vehicle_financing.csv', 'insurance_policies.csv']) {
    zip.addFile(f, Buffer.from('id\n', 'utf-8'));
  }
  return zip.toBuffer();
}

describe('backup version bump and restore shim', () => {
  test('a new 2.0.0 cents backup round-trips with exact integer-cents equality', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const veh = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    const vehicle = (await veh.json()) as { data: { id: string } };
    expect(veh.status, JSON.stringify(vehicle)).toBe(201);

    // Written in cents directly. This checks the round-trip, not input conversion.
    const expenseId = 'e_t2_roundtrip';
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES (?, ?, ?, 'fuel', 1700000000, 4550)`,
      [expenseId, vehicle.data.id, ctx.user.id]
    );
    expect(expenseAmountCents(expenseId)).toBe(4550);

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Current-version backups get no shim, so the value must match exactly.
    expect(expenseAmountCents(expenseId)).toBe(4550);
  });

  test('a PRE-CENTS 1.0.0 dollar backup is ×100-shimmed to cents on restore (12.34 → 1234)', async () => {
    const { restoreService } = await import('../restore');
    // Without the shim, 12.34 would round to 12 cents.
    const zip = buildBackupZip('1.0.0', '12.34');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Rounds before scaling, so 12.34 becomes 1234 cents, not 1233.
    expect(expenseAmountCents('e_t2')).toBe(1234);
  });

  test('the shim handles a binary-float edge dollar value (19.99 → 1999, not 1998)', async () => {
    const { restoreService } = await import('../restore');
    const zip = buildBackupZip('1.0.0', '19.99');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(expenseAmountCents('e_t2')).toBe(1999);
  });

  test('a future-version backup is rejected', async () => {
    const { restoreService } = await import('../restore');
    // 3.0.0 is not pre-cents, so no shim runs and the version check rejects it.
    const zip = buildBackupZip('3.0.0', '12.34');
    // The failure must be the version check, not some other validation error.
    let thrown: unknown;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const details = (thrown as { details?: string[] }).details ?? [];
    expect(details.some((d) => /version/i.test(d))).toBe(true);
    // The expense must not be inserted.
    expect(expenseAmountCents('e_t2')).toBeUndefined();
  });

  test('isPreCentsBackup classifies versions correctly', async () => {
    const { isPreCentsBackup } = await import('../backup');
    expect(isPreCentsBackup('1.0.0')).toBe(true);
    expect(isPreCentsBackup('1.5.2')).toBe(true);
    expect(isPreCentsBackup('2.0.0')).toBe(false); // already cents
    expect(isPreCentsBackup('3.0.0')).toBe(false); // future — not shimmable, fail-closed
    expect(isPreCentsBackup(undefined)).toBe(false); // no version → fail-closed (validate rejects)
  });
});
