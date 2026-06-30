/**
 * money-cents-migration T2 — the NORTH_STAR #1 data-safety gate.
 *
 * After migration 0009 the 14 money columns are integer CENTS. A backup taken under the OLD float-dollars
 * schema (metadata.version 1.0.0, money written as `12.34`) must NEVER silently corrupt when restored into
 * the cents schema. Two mechanisms ship together (design §4):
 *   1. CONFIG.backup.currentVersion bumped 1.0.0 → 2.0.0 — a naive restore of an UNSHIMMABLE old/foreign
 *      version fails the validateBackupData version check (fail-closed default), never corrupting.
 *   2. A version-gated ×100 shim (coerceRow shimMoneyToCents, driven by isPreCentsBackup) — a pre-cents
 *      backup's dollar money is scaled to cents on restore, so the user's old backup round-trips CORRECTLY.
 *
 * These tests drive the REAL export→restore stack (createTestApp → exportAsZip → restoreFromBackup) plus a
 * hand-built 1.0.0 dollar-float ZIP to prove the shim, and assert against the RAW cents DB rows.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Raw cents value of the seeded/created expense, read straight from SQLite (NOT the dollar API edge). */
function expenseAmountCents(id: string): number | undefined {
  const row = ctx.sqlite.query('SELECT expense_amount FROM expenses WHERE id = ?').get(id) as {
    expense_amount: number;
  } | null;
  return row?.expense_amount;
}

/**
 * Build a minimal but VALID backup ZIP at a chosen metadata.version with ONE vehicle + ONE expense whose
 * expense_amount is written as the given raw cell string. metadata.userId is the test user's so the
 * userId check passes. Mirrors backupService.convertToCSV's format (camelCase headers, quoted).
 */
function buildBackupZip(version: string, expenseAmountCell: string): Buffer {
  const userId = ctx.user.id;
  const vehicleId = 'v_t2';
  const expenseId = 'e_t2';
  const zip = new AdmZip();
  zip.addFile(
    'metadata.json',
    Buffer.from(JSON.stringify({ version, timestamp: new Date(0).toISOString(), userId }), 'utf-8')
  );
  // Only the columns the insert needs; coerceRow fills the rest. Headers are drizzle FIELD names.
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
  // The remaining tables are optional (OPTIONAL_BACKUP_FILES) — financing/insurance/etc. absent is fine.
  // But the REQUIRED non-optional files must be present; add empty ones to satisfy parseZipBackup.
  for (const f of ['vehicle_financing.csv', 'insurance_policies.csv']) {
    zip.addFile(f, Buffer.from('id\n', 'utf-8'));
  }
  return zip.toBuffer();
}

describe('money-cents-migration T2: backup version bump + restore shim (NORTH_STAR #1)', () => {
  test('a NEW 2.0.0 cents backup round-trips with EXACT integer-cents equality', async () => {
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    // Create a vehicle, then an expense via the real routes.
    const veh = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
    });
    const vehicle = (await veh.json()) as { data: { id: string } };
    expect(veh.status, JSON.stringify(vehicle)).toBe(201);

    // Insert the expense DIRECTLY in cents (this test pins the round-trip contract, NOT the T3 input edge:
    // the stored value must SURVIVE export→restore byte-for-byte regardless of how it was written).
    const expenseId = 'e_t2_roundtrip';
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES (?, ?, ?, 'fuel', 1700000000, 4550)`,
      [expenseId, vehicle.data.id, ctx.user.id]
    );
    expect(expenseAmountCents(expenseId)).toBe(4550);

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // The export metadata is the current (2.0.0) version → no shim → exact equality.
    expect(expenseAmountCents(expenseId)).toBe(4550);
  });

  test('a PRE-CENTS 1.0.0 dollar backup is ×100-shimmed to cents on restore (12.34 → 1234)', async () => {
    const { restoreService } = await import('../restore');
    // Old backup: expense_amount written as DOLLARS "12.34". Under the cents schema, without the shim
    // coerceRow would Math.round(12.34) = 12 cents = $0.12 (the 100× corruption).
    const zip = buildBackupZip('1.0.0', '12.34');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // Shim ×100 with ROUND-before-int: 12.34 → 1234 cents, NOT 12 and NOT 1233.
    expect(expenseAmountCents('e_t2')).toBe(1234);
  });

  test('the shim handles a binary-float edge dollar value (19.99 → 1999, not 1998)', async () => {
    const { restoreService } = await import('../restore');
    const zip = buildBackupZip('1.0.0', '19.99');
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(expenseAmountCents('e_t2')).toBe(1999);
  });

  test('an UNSHIMMABLE future-version backup FAILS CLOSED (rejected, never corrupts)', async () => {
    const { restoreService } = await import('../restore');
    // A 3.0.0 backup we do not understand: isPreCentsBackup is false (major >= 2), so NO shim runs and the
    // version stays 3.0.0 → validateBackupData's version check (expects 2.0.0) rejects it. The user's data
    // is NOT silently coerced under an unknown format.
    const zip = buildBackupZip('3.0.0', '12.34');
    // validateBackupData rejects on the version mismatch → restore throws a SyncError ("Backup validation
    // failed") whose `details` array carries the version-mismatch reason. Assert both the throw and that
    // the reason is the version check (not some other validation failure).
    let thrown: unknown;
    try {
      await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const details = (thrown as { details?: string[] }).details ?? [];
    expect(details.some((d) => /version/i.test(d))).toBe(true);
    // And critically: the expense was NOT inserted (no corruption under the unknown format).
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
