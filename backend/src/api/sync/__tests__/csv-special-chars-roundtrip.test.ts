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

async function roundTrip(): Promise<void> {
  const { backupService } = await import('../backup');
  const { restoreService } = await import('../restore');
  const zip = await backupService.exportAsZip(ctx.user.id);
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

function vehicleNickname(id: string): string | null {
  return (
    ctx.sqlite.query('SELECT nickname FROM vehicles WHERE id = ?').get(id) as {
      nickname: string | null;
    }
  ).nickname;
}

function expenseDescription(id: string): string | null {
  return (
    ctx.sqlite.query('SELECT description FROM expenses WHERE id = ?').get(id) as {
      description: string | null;
    }
  ).description;
}

describe('backup → restore round-trip preserves RFC-4180 special characters in free text', () => {
  const HOSTILE = 'Joe\'s "Daily", commute\nsecond line';

  test('a vehicle nickname with comma + quote + embedded newline survives byte-for-byte', async () => {
    const res = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Subaru',
      model: 'Forester',
      year: 2021,
      nickname: HOSTILE,
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBeLessThan(300);
    const id = body.data.id;
    expect(vehicleNickname(id)).toBe(HOSTILE);

    await roundTrip();

    expect(vehicleNickname(id), 'the special-char nickname must survive export→import intact').toBe(
      HOSTILE
    );
  });

  test('an expense description with the same hostile value survives, and a leading-`=` value is NOT mangled', async () => {
    const vRes = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Honda',
      model: 'Civic',
      year: 2020,
    });
    const vehicleId = (await json<DataEnvelope<{ id: string }>>(vRes)).data.id;

    const eRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 49.99,
      date: '2024-02-01',
      description: HOSTILE,
    });
    const eBody = await json<DataEnvelope<{ id: string }>>(eRes);
    expect(eRes.status, JSON.stringify(eBody)).toBeLessThan(300);
    const eId = eBody.data.id;

    const fRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 12.5,
      date: '2024-02-02',
      description: '=SUM(A1:A9)+1',
    });
    const fId = (await json<DataEnvelope<{ id: string }>>(fRes)).data.id;

    await roundTrip();

    expect(expenseDescription(eId), 'comma/quote/newline description survives').toBe(HOSTILE);
    expect(
      expenseDescription(fId),
      'a leading-= description round-trips verbatim (NOT neutralized — backup is lossless, not human-facing)'
    ).toBe('=SUM(A1:A9)+1');
  });
});
