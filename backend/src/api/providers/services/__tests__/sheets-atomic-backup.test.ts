/**
 * Regression GUARD (committed, travels with the merge) for the #37 bug class (fixed C44):
 * the Google Sheets BACKUP must be ATOMIC — stage every table into temp `__vroom_staging` tabs, then
 * swap them in with ONE batchUpdate (delete old canonical sheets + rename staging → canonical).
 *
 * The pre-C44 design did per-sheet `values.clear()` THEN `values.update()` on the LIVE sheets, so a
 * failure mid-run left a TORN backup — some sheets rewritten, the one mid-write EMPTIED by its own
 * preceding clear, the rest stale — on what may be the user's ONLY copy (NORTH_STAR #1 silent data-loss).
 *
 * The C44 fake-seam test (google-sheets-service.test.ts) proves the CURRENT path is atomic by simulating
 * a mid-backup failure, but it only drives the one code path that exists today. This SOURCE SCAN is the
 * tree-wide structural net: it pins the invariant that the safety rests on, so a future refactor that
 * silently reintroduces the footgun regresses RED here even if no test happens to exercise the new path
 * (source-scan > untracked e2e for merge survival — GUIDE).
 *
 * The load-bearing properties (any one reverting = the data-loss bug is back):
 *   1. NO `values.clear(` anywhere in the Sheets service — clearing a live sheet before writing IS the
 *      destructive in-place mechanism. The atomic design has no clear at all (staging tabs are born empty).
 *   2. The staging mechanism is present — a `SHEET_STAGING_SUFFIX` constant, and the swap uses
 *      `deleteSheet` + `updateSheetProperties` (delete-old + rename-staging) in the commit batch.
 *   3. The staging suffix is SPACE-FREE — it's interpolated UNQUOTED into A1 ranges (`${title}${suffix}!A1`),
 *      so a space would silently corrupt every staging write's range.
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The Sheets service is the only module that writes the backup spreadsheet.
const SHEETS_SERVICE = join(HERE, '..', 'google-sheets-service.ts');

function serviceSource(): string {
  return readFileSync(SHEETS_SERVICE, 'utf8');
}

describe('Sheets backup is atomic — stage-then-swap (#37 class guard)', () => {
  test('the scan resolves the real Sheets service file (guard is live, not a no-op)', () => {
    expect(serviceSource().length, `unreadable/empty: ${SHEETS_SERVICE}`).toBeGreaterThan(100);
  });

  test('the backup path never calls values.clear (no destructive in-place clear)', () => {
    const src = serviceSource();
    // Match an actual call `…values.clear(` (any receiver), tolerant of whitespace. The atomic design
    // removed clearing entirely; a clear-then-write revert is the exact #37 footgun.
    const clearCalls = [...src.matchAll(/\.values\s*\.\s*clear\s*\(/g)];
    expect(
      clearCalls.length,
      `google-sheets-service.ts calls values.clear() ${clearCalls.length} time(s). Clearing a LIVE backup ` +
        `sheet before writing is the non-atomic footgun (#37): a mid-run failure leaves a torn/emptied ` +
        `backup on the user's only copy. Stage into temp tabs + swap atomically instead.`
    ).toBe(0);
  });

  test('the atomic staging + swap mechanism is present', () => {
    const src = serviceSource();
    expect(
      /SHEET_STAGING_SUFFIX\s*=\s*['"][^'"]+['"]/.test(src),
      'no SHEET_STAGING_SUFFIX constant — the staging-tab mechanism the atomic swap needs is gone (#37).'
    ).toBe(true);
    // The commit swap deletes the old canonical sheets and renames staging → canonical in one batch.
    expect(
      src.includes('deleteSheet'),
      'swap no longer issues deleteSheet (#37 commit step missing)'
    ).toBe(true);
    expect(
      src.includes('updateSheetProperties'),
      'swap no longer renames staging → canonical via updateSheetProperties (#37 commit step missing)'
    ).toBe(true);
  });

  test('the staging suffix is space-free (interpolated UNQUOTED into A1 ranges)', () => {
    const src = serviceSource();
    const m = src.match(/SHEET_STAGING_SUFFIX\s*=\s*['"]([^'"]+)['"]/);
    expect(m, 'SHEET_STAGING_SUFFIX assignment not found').not.toBeNull();
    const suffix = m?.[1] ?? '';
    expect(
      /\s/.test(suffix),
      `SHEET_STAGING_SUFFIX ("${suffix}") contains whitespace. It's interpolated UNQUOTED into A1 ranges ` +
        `(\`\${title}\${suffix}!A1:…\`), so a space silently corrupts every staging write's range.`
    ).toBe(false);
    expect(
      suffix.length,
      'SHEET_STAGING_SUFFIX is empty — staging tabs would collide with canonical ones'
    ).toBeGreaterThan(0);
  });
});
