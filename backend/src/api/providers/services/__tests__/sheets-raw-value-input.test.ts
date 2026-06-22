/**
 * Regression GUARD (committed, travels with the merge) for the #36 bug class (fixed C24):
 * a Google Sheets BACKUP write must use `valueInputOption: 'RAW'`, never 'USER_ENTERED'.
 *
 * USER_ENTERED makes Sheets PARSE each cell as if a human typed it: a value beginning with a
 * formula trigger (`=` `+` `-` `@`) becomes a LIVE formula (injection), and the cell silently
 * round-trips back as the formula RESULT, not the text the user stored — corruption of the user's
 * OWN backup (NORTH_STAR #1). RAW stores the literal string, so backup→restore is byte-exact and
 * inert. The C24 fix flipped the single write site to RAW.
 *
 * The C24 fake-seam test (google-sheets-service.test.ts) asserts the CURRENT write path sends RAW,
 * but it only drives the one code path that exists today. This SOURCE SCAN is the tree-wide net: it
 * pins that EVERY `valueInputOption:` assignment in the Sheets service is 'RAW', so a future reformat
 * flipping it back, OR a NEW write site added with USER_ENTERED, regresses RED here even if no test
 * happens to exercise that new path. (Source-scan > untracked e2e for merge survival — GUIDE.)
 *
 * It scans the ASSIGNMENT (`valueInputOption: '<x>'`), NOT a bare `USER_ENTERED` substring — the fix's
 * own explanatory comment contains the word USER_ENTERED, which a naive grep would false-positive on.
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The Sheets service is the only module that writes spreadsheet values.
const SHEETS_SERVICE = join(HERE, '..', 'google-sheets-service.ts');

// Every `valueInputOption: '<value>'` assignment (single or double quoted). Captures the value so we
// can assert it positively; whitespace-tolerant.
const VALUE_INPUT_OPTION = /valueInputOption\s*:\s*['"]([^'"]+)['"]/g;

describe('Sheets backup writes use RAW value-input (#36 class guard)', () => {
  test('the scan resolves the real Sheets service file (guard is live, not a no-op)', () => {
    expect(
      readFileSync(SHEETS_SERVICE, 'utf8').length,
      `unreadable/empty: ${SHEETS_SERVICE}`
    ).toBeGreaterThan(100);
  });

  test('every valueInputOption assignment is RAW — none is USER_ENTERED', () => {
    const src = readFileSync(SHEETS_SERVICE, 'utf8');
    const found = [...src.matchAll(VALUE_INPUT_OPTION)].map((m) => m[1]);

    // There must be at least one write site (else the regex broke or the write was removed — a guard
    // that silently matches nothing is a no-op).
    expect(
      found.length,
      'no valueInputOption assignment found in google-sheets-service.ts — did the write path move?'
    ).toBeGreaterThan(0);

    const offenders = found.filter((v) => v !== 'RAW');
    expect(
      offenders,
      `A Sheets backup write uses a non-RAW valueInputOption (${offenders.join(', ')}). USER_ENTERED ` +
        `lets a "=…" cell become a live formula + silently round-trips as the formula result — backup ` +
        `corruption (#36). Use 'RAW' so cells are stored verbatim.`
    ).toEqual([]);
  });
});
