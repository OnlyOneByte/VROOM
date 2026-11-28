import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { useTestApp } from '../../../test-helpers/http-client';
import { backupService, centsToMinorUnits, rescaleParts } from '../backup';
import { restoreService } from '../restore';

const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'backup-2.0.0');
const LOAN_PAYMENT_ID = 'xdfo83wsg1gk954b2slxyb2s';

const app = useTestApp();

function fixtureZip(currency: string, version?: string): Buffer {
  const zip = new AdmZip();
  for (const name of readdirSync(FIXTURE_DIR).sort()) {
    let content = readFileSync(join(FIXTURE_DIR, name), 'utf-8');
    if (name === 'user_preferences.csv') content = content.replace('"USD"', `"${currency}"`);
    if (name === 'metadata.json' && version) {
      content = JSON.stringify({ ...JSON.parse(content), version });
    }
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
}

function stored(sql: string, ...params: string[]): number {
  return (
    Object.values(
      app()
        .sqlite.query(sql)
        .get(...params) as Record<string, number>
    )[0] ?? NaN
  );
}

const loanPayment = () =>
  stored('SELECT expense_amount FROM expenses WHERE id = ?', LOAN_PAYMENT_ID);

describe('backup 3.1.0 stores minor units of the backup currency', () => {
  test('a 2.0.0 backup restores, exports as 3.1.0 and restores again unchanged', async () => {
    const first = await restoreService.restoreFromBackup(
      app().user.id,
      fixtureZip('USD'),
      'replace'
    );
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(loanPayment()).toBe(37286);

    const exported = await backupService.exportAsZip(app().user.id);
    const metadata = JSON.parse(new AdmZip(exported).readAsText('metadata.json'));
    expect(metadata.version).toBe('3.1.0');

    const second = await restoreService.restoreFromBackup(app().user.id, exported, 'replace');
    expect(second.success, JSON.stringify(second)).toBe(true);
    expect(loanPayment()).toBe(37286);
  });

  test('a 2.0.0 backup in a no-decimal currency is rescaled once, never twice', async () => {
    const first = await restoreService.restoreFromBackup(
      app().user.id,
      fixtureZip('JPY'),
      'replace'
    );
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(loanPayment()).toBe(373);

    const exported = await backupService.exportAsZip(app().user.id);
    const second = await restoreService.restoreFromBackup(app().user.id, exported, 'replace');
    expect(second.success, JSON.stringify(second)).toBe(true);
    expect(loanPayment()).toBe(373);
  });

  test('a 3.0.0 yen backup still holds cents and is rescaled on restore', async () => {
    const result = await restoreService.restoreFromBackup(
      app().user.id,
      fixtureZip('JPY', '3.0.0'),
      'replace'
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(loanPayment()).toBe(373);
  });

  test('equal remainders go to the earlier part, compared exactly', () => {
    expect(rescaleParts(4566, [3333, 1233], 100, 1)).toEqual({ total: 46, parts: [34, 12] });
  });

  test('split legs still add up to their group total after rounding', () => {
    const legs = ['a', 'b', 'c'].map((id) => ({
      id,
      groupId: 'g',
      groupTotal: '10000',
      expenseAmount: '3333',
    }));
    legs[0] = { ...legs[0], expenseAmount: '3334' } as (typeof legs)[number];
    const { expenses = [] } = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'JPY' }],
      expenses: legs,
    });
    expect(expenses.map((leg) => leg.expenseAmount)).toEqual([34, 33, 33]);
    expect(expenses[0]?.groupTotal).toBe(100);
  });

  test('absolute reminder split allocations are rescaled with the amount', () => {
    const split = { method: 'absolute', allocations: [{ vehicleId: 'v', amount: 120000 }] };
    const { reminders = [] } = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'JPY' }],
      reminders: [{ expenseAmount: '120000', expenseSplitConfig: JSON.stringify(split) }],
    });
    expect(reminders[0]?.expenseAmount).toBe(1200);
    expect(JSON.parse(String(reminders[0]?.expenseSplitConfig)).allocations[0].amount).toBe(1200);
  });

  test('the frozen 3.1.0 yen fixture is unchanged and restores without rescaling', async () => {
    const dir = join(import.meta.dir, 'fixtures', 'backup-3.1.0-jpy');
    const hash = createHash('sha256');
    const zip = new AdmZip();
    for (const name of readdirSync(dir).sort()) {
      hash.update(name);
      hash.update(readFileSync(join(dir, name)));
      zip.addFile(name, readFileSync(join(dir, name)));
    }
    expect(hash.digest('hex')).toBe(
      '856b2152dac1a77338af224739a0707fcbd91befcd19dba57dd876e44931a43c'
    );
    const result = await restoreService.restoreFromBackup(app().user.id, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(loanPayment()).toBe(373);
  });

  test('rounding never pushes a leg below zero, and the legs keep their total', () => {
    const legs = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      groupId: 'g',
      groupTotal: '200',
      expenseAmount: '50',
    }));
    const { expenses = [] } = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'JPY' }],
      expenses: legs,
    });
    const amounts = expenses.map((leg) => Number(leg.expenseAmount));
    expect(amounts.every((amount) => amount >= 0)).toBe(true);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  test('absolute reminder allocations keep adding up to the amount', () => {
    const split = {
      method: 'absolute',
      allocations: ['a', 'b', 'c'].map((vehicleId, i) => ({
        vehicleId,
        amount: i === 0 ? 3334 : 3333,
      })),
    };
    const { reminders = [] } = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'JPY' }],
      reminders: [{ expenseAmount: '10000', expenseSplitConfig: split }],
    });
    const out = reminders[0]?.expenseSplitConfig as typeof split;
    expect(reminders[0]?.expenseAmount).toBe(100);
    expect(out.allocations.map((a) => a.amount)).toEqual([34, 33, 33]);
  });

  test('restoring a backup without preferences into a yen account rescales it', async () => {
    await app().sql.run(
      'INSERT INTO user_preferences (user_id, currency_unit) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET currency_unit = excluded.currency_unit',
      [app().user.id, 'JPY']
    );
    const zip = new AdmZip(fixtureZip('USD'));
    zip.deleteFile('user_preferences.csv');
    const result = await restoreService.restoreFromBackup(app().user.id, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(loanPayment()).toBe(373);
  });

  test('a backup without preferences is rescaled with the account currency', () => {
    const { expenses = [] } = centsToMinorUnits({ expenses: [{ expenseAmount: '120000' }] }, 'JPY');
    expect(expenses[0]?.expenseAmount).toBe(1200);
  });

  test('an absolute reminder split without allocations passes through', () => {
    const { reminders = [] } = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'JPY' }],
      reminders: [{ expenseAmount: '5050', expenseSplitConfig: '{"method":"absolute"}' }],
    });
    expect(reminders[0]).toEqual({
      expenseAmount: 51,
      expenseSplitConfig: '{"method":"absolute"}',
    });
  });

  test('two-decimal currencies pass through untouched', () => {
    const tables = {
      userPreferences: [{ currencyUnit: 'EUR' }],
      expenses: [{ expenseAmount: '1234' }],
    };
    expect(centsToMinorUnits(tables)).toBe(tables);
  });
});
