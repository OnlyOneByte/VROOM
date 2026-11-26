import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { useTestApp } from '../../../test-helpers/http-client';
import * as money from '../../../utils/money';
import { backupService, centsToMinorUnits } from '../backup';
import { restoreService } from '../restore';

const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'backup-2.0.0');
const LOAN_PAYMENT_ID = 'xdfo83wsg1gk954b2slxyb2s';

const app = useTestApp();
afterEach(() => mock.restore());

function wholeYen(): void {
  spyOn(money, 'minorUnitScale').mockImplementation((currency) => (currency === 'JPY' ? 1 : 100));
}

function fixtureZip(currency: string): Buffer {
  const zip = new AdmZip();
  for (const name of readdirSync(FIXTURE_DIR).sort()) {
    let content = readFileSync(join(FIXTURE_DIR, name), 'utf-8');
    if (name === 'user_preferences.csv') content = content.replace('"USD"', `"${currency}"`);
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

describe('backup 3.0.0 stores minor units of the backup currency', () => {
  test('a 2.0.0 backup restores, exports as 3.0.0 and restores again unchanged', async () => {
    const first = await restoreService.restoreFromBackup(
      app().user.id,
      fixtureZip('USD'),
      'replace'
    );
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(loanPayment()).toBe(37286);

    const exported = await backupService.exportAsZip(app().user.id);
    const metadata = JSON.parse(new AdmZip(exported).readAsText('metadata.json'));
    expect(metadata.version).toBe('3.0.0');

    const second = await restoreService.restoreFromBackup(app().user.id, exported, 'replace');
    expect(second.success, JSON.stringify(second)).toBe(true);
    expect(loanPayment()).toBe(37286);
  });

  test('a 2.0.0 backup in a no-decimal currency is rescaled once, never twice', async () => {
    wholeYen();
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

  test('split legs still add up to their group total after rounding', () => {
    wholeYen();
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
    wholeYen();
    const split = { method: 'absolute', allocations: [{ vehicleId: 'v', amount: 120000 }] };
    const { reminders = [] } = centsToMinorUnits({
      userPreferences: [{ currencyUnit: 'JPY' }],
      reminders: [{ expenseAmount: '120000', expenseSplitConfig: JSON.stringify(split) }],
    });
    expect(reminders[0]?.expenseAmount).toBe(1200);
    expect(JSON.parse(String(reminders[0]?.expenseSplitConfig)).allocations[0].amount).toBe(1200);
  });

  test('the frozen 3.0.0 yen fixture is unchanged and restores without rescaling', async () => {
    const dir = join(import.meta.dir, 'fixtures', 'backup-3.0.0-jpy');
    const hash = createHash('sha256');
    const zip = new AdmZip();
    for (const name of readdirSync(dir).sort()) {
      hash.update(name);
      hash.update(readFileSync(join(dir, name)));
      zip.addFile(name, readFileSync(join(dir, name)));
    }
    expect(hash.digest('hex')).toBe(
      '8b93aa4f2b02f47582608899d5ea8eb1619360b67b139113d603ada424bf7b98'
    );
    wholeYen();
    const result = await restoreService.restoreFromBackup(app().user.id, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(loanPayment()).toBe(373);
  });

  test('rounding never pushes a leg below zero, and the legs keep their total', () => {
    wholeYen();
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
    wholeYen();
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
    wholeYen();
    app().sqlite.run(
      'INSERT OR REPLACE INTO user_preferences (user_id, currency_unit) VALUES (?, ?)',
      [app().user.id, 'JPY']
    );
    const zip = new AdmZip(fixtureZip('USD'));
    zip.deleteFile('user_preferences.csv');
    const result = await restoreService.restoreFromBackup(app().user.id, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(loanPayment()).toBe(373);
  });

  test('a backup without preferences is rescaled with the account currency', () => {
    wholeYen();
    const { expenses = [] } = centsToMinorUnits({ expenses: [{ expenseAmount: '120000' }] }, 'JPY');
    expect(expenses[0]?.expenseAmount).toBe(1200);
  });

  test('two-decimal currencies pass through untouched', () => {
    const tables = {
      userPreferences: [{ currencyUnit: 'EUR' }],
      expenses: [{ expenseAmount: '1234' }],
    };
    expect(centsToMinorUnits(tables)).toBe(tables);
  });
});
