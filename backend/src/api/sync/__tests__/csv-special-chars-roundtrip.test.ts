/**
 * TRUE backup → restore round-trip for free-text values containing RFC-4180 special characters
 * (C433 deep-review→guard). Data-safety quality bar #1: no silent loss.
 *
 * The CSV backup serializes via csv-stringify (`quoted: true`) and restores via csv-parse — a pairing
 * that IS correct (the library escapes embedded delimiters/quotes/newlines per RFC-4180). But the
 * existing round-trip tests (claims / maintenance-fields / reminder-split-config) only seed plain
 * values — NONE drives a free-text field carrying a comma, an embedded double-quote, or a newline
 * through the real export→import. So the quoting contract that stands between a comma in a description
 * and a column-shifted/corrupted restore was unpinned. These pin it FIRSTHAND through the REAL
 * backupService.exportAsZip → restoreService.restoreFromBackup (NOT a local re-implementation of the
 * stringifier — that's the coverage-theater trap), asserting the value survives byte-for-byte.
 *
 * Free-text columns are the live surface: vehicles.nickname, expenses.description,
 * insurancePolicies.notes, reminders.description are all user free-text that routinely contain commas,
 * quotes, and pasted multi-line text. NOTE: the backup path deliberately does NOT neutralize CSV
 * formula-injection (csv-safety.ts:16 — that's one-way human-export only; the round-trip ZIP must
 * preserve the value verbatim so restore is lossless), so a leading-`=` value must come back EXACTLY,
 * apostrophe-free — that's the assertion here, NOT a neutralized form.
 *
 * createTestApp() rewrites env then dynamic-imports the DB-bound backup/restore modules, so they're
 * imported dynamically AFTER createTestApp (the C291/C300 harness pattern).
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
  // A single value exercising every CSV-hostile construct at once: a comma (field separator), a
  // double-quote (the quoting char — must be doubled then un-doubled), and an embedded newline (would
  // otherwise look like a new record). If any of the three breaks the quoting, the field shifts or
  // truncates and this byte-for-byte assertion fails.
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
    // Sanity: it persisted as typed pre-round-trip (rules out a write-path mangle masking the result).
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

    // A formula-trigger-led value: the round-trip ZIP must NOT neutralize it (no leading apostrophe
    // added) — backup is a restore artifact, not a human export (csv-safety.ts:16).
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
