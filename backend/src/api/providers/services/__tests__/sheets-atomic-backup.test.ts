import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEETS_SERVICE = join(HERE, '..', 'google-sheets-service.ts');

function serviceSource(): string {
  return readFileSync(SHEETS_SERVICE, 'utf8');
}

describe('Sheets backup is atomic — stage-then-swap', () => {
  test('the source scan finds the Sheets service file', () => {
    expect(serviceSource().length, `unreadable/empty: ${SHEETS_SERVICE}`).toBeGreaterThan(100);
  });

  test('the backup path never calls values.clear (no destructive in-place clear)', () => {
    const src = serviceSource();
    const clearCalls = [...src.matchAll(/\.values\s*\.\s*clear\s*\(/g)];
    expect(
      clearCalls.length,
      `google-sheets-service.ts calls values.clear() ${clearCalls.length} time(s). Clearing a LIVE backup ` +
        `sheet before writing is the non-atomic footgun: a mid-run failure leaves a torn/emptied ` +
        `backup on the user's only copy. Stage into temp tabs + swap atomically instead.`
    ).toBe(0);
  });

  test('the atomic staging + swap mechanism is present', () => {
    const src = serviceSource();
    expect(
      /SHEET_STAGING_SUFFIX\s*=\s*['"][^'"]+['"]/.test(src),
      'no SHEET_STAGING_SUFFIX constant — the staging-tab mechanism the atomic swap needs is gone.'
    ).toBe(true);
    expect(
      src.includes('deleteSheet'),
      'swap no longer issues deleteSheet (commit step missing)'
    ).toBe(true);
    expect(
      src.includes('updateSheetProperties'),
      'swap no longer renames staging → canonical via updateSheetProperties (commit step missing)'
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
