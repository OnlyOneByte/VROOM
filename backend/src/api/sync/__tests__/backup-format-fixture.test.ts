import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { CONFIG } from '../../../config';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { restoreService } from '../restore';

const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'backup-2.0.0');
const FIXTURE_SHA256 = 'a49cd12f3702c51e8530396e1c9043054c825d2add19715000c3b49024f140ce';

let ctx: TestApp;
let savedVersion: string;

beforeEach(async () => {
  ctx = await createTestApp();
  savedVersion = CONFIG.backup.currentVersion;
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  setCurrentVersion(savedVersion);
  ctx.close();
});

function setCurrentVersion(version: string): void {
  (CONFIG.backup as { currentVersion: string }).currentVersion = version;
}

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR).sort();
}

function fixtureZip(version?: string): Buffer {
  const zip = new AdmZip();
  for (const name of fixtureFiles()) {
    let content = readFileSync(join(FIXTURE_DIR, name), 'utf-8');
    if (name === 'metadata.json' && version) {
      content = JSON.stringify({ ...JSON.parse(content), version });
    }
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
}

function count(table: string): number {
  return (ctx.sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

async function restoreError(zip: Buffer): Promise<string[]> {
  try {
    await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  } catch (error) {
    return (error as { details?: string[] }).details ?? [String(error)];
  }
  return [];
}

describe('the frozen 2.0.0 backup fixture', () => {
  test('is unchanged: add a new fixture for a new format instead of editing this one', () => {
    const hash = createHash('sha256');
    for (const name of fixtureFiles()) {
      hash.update(name);
      hash.update(readFileSync(join(FIXTURE_DIR, name)));
    }
    expect(hash.digest('hex')).toBe(FIXTURE_SHA256);
  });

  test('restores on the current schema with its data intact', async () => {
    const result = await restoreService.restoreFromBackup(ctx.user.id, fixtureZip(), 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(count('vehicles')).toBe(2);
    expect(count('expenses')).toBe(95);
    expect(count('vehicle_financing')).toBe(1);
    expect(count('insurance_policies')).toBe(2);
    expect(count('insurance_claims')).toBe(1);
    expect(count('odometer_entries')).toBe(1);
    expect(count('trips')).toBe(1);
    expect(count('reminders')).toBe(1);
    const loan = ctx.sqlite
      .query('SELECT expense_amount FROM expenses WHERE id = ?')
      .get('xdfo83wsg1gk954b2slxyb2s') as { expense_amount: number };
    expect(loan.expense_amount).toBe(37286);
  });

  test('still restores after the format moves to 2.1.0', async () => {
    setCurrentVersion('2.1.0');

    const result = await restoreService.restoreFromBackup(ctx.user.id, fixtureZip(), 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(count('expenses')).toBe(95);
  });

  test('a backup from a newer minor version is refused with a clear message', async () => {
    const details = await restoreError(fixtureZip('3.2.0'));

    expect(details.join('\n')).toMatch(/newer version of VROOM.*Update VROOM/);
    expect(count('vehicles')).toBe(0);
  });

  test('a backup from a newer major version is refused with a clear message', async () => {
    setCurrentVersion('3.2.0');

    const details = await restoreError(fixtureZip('4.0.0'));

    expect(details.join('\n')).toMatch(/newer version of VROOM.*Update VROOM/);
    expect(count('vehicles')).toBe(0);
  });
});
