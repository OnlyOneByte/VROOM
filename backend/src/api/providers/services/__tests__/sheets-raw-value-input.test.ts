import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEETS_SERVICE = join(HERE, '..', 'google-sheets-service.ts');

const VALUE_INPUT_OPTION = /valueInputOption\s*:\s*['"]([^'"]+)['"]/g;

describe('Sheets backup writes use RAW value-input', () => {
  test('the source scan finds the Sheets service file', () => {
    expect(
      readFileSync(SHEETS_SERVICE, 'utf8').length,
      `unreadable/empty: ${SHEETS_SERVICE}`
    ).toBeGreaterThan(100);
  });

  test('every valueInputOption assignment is RAW — none is USER_ENTERED', () => {
    const src = readFileSync(SHEETS_SERVICE, 'utf8');
    const found = [...src.matchAll(VALUE_INPUT_OPTION)].map((m) => m[1]);

    expect(
      found.length,
      'no valueInputOption assignment found in google-sheets-service.ts — did the write path move?'
    ).toBeGreaterThan(0);

    const offenders = found.filter((v) => v !== 'RAW');
    expect(
      offenders,
      `A Sheets backup write uses a non-RAW valueInputOption (${offenders.join(', ')}). USER_ENTERED ` +
        `lets a "=…" cell become a live formula + silently round-trips as the formula result — backup ` +
        `corruption. Use 'RAW' so cells are stored verbatim.`
    ).toEqual([]);
  });
});
