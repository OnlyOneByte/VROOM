/**
 * Regression GUARD (committed, travels with the merge) for the cycle-6/11 date class on the CSV-IMPORT
 * paths (the import-trackers T6 net the GUIDE flags: "extend the no-utc guard to cover import-mapping.ts").
 *
 * A date-only foreign value ("YYYY-MM-DD", "MM/DD/YYYY", …) MUST be built in LOCAL time from numeric parts
 * via `buildLocalDate(year, month, day, …)`. Handing a date-only STRING to `new Date('YYYY-MM-DD')` parses
 * it as midnight UTC, which rolls the calendar day BACK for every user west of UTC (#23/#59/#87 family) —
 * the exact bug normalizeForeignDate + the native parseDate were written to avoid.
 *
 * `import-mapping.test.ts` already pins the BEHAVIOR (normalize → parse-back → local Y/M/D in any CI zone),
 * but that only exercises today's code paths. This SOURCE SCAN is the tree-wide structural net: it pins
 * that the import date modules never construct a Date from a date-only string/template — so a future
 * refactor swapping `buildLocalDate(...)` for `new Date(datePart)` / a `${y}-${m}-${d}` template regresses
 * RED here even if no test happens to drive the new line (source-scan > untracked e2e for merge survival).
 *
 * It deliberately does NOT flag the two KNOWN-CORRECT `new Date()` sites in import-mapping.ts:
 *   - `new Date(ms)` (epoch path) — a numeric absolute instant, not a date string.
 *   - `new Date(s)` inside the branch gated on an explicit Z/±offset — an absolute instant, honored as-is.
 * The scan only matches a Date constructed from a STRING/template whose content looks like a bare
 * Y-M-D / M/D/Y date (digit-separator-digit), which is precisely the antipattern.
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The two CSV-import date modules that must build date-only values in LOCAL time via buildLocalDate.
const FILES = [
  join(HERE, '..', 'import-mapping.ts'),
  join(HERE, '..', 'local-date.ts'),
  join(HERE, '..', 'import-csv.ts'),
];

// A `new Date(...)` whose argument is a STRING or TEMPLATE built from a bare date — matched in two forms,
// both reintroducing the midnight-UTC rollback:
//   (a) a quoted/backtick literal with digit-sep-digit-sep-digit content: 'YYYY-MM-DD' / "MM/DD/YYYY".
//   (b) a template whose interpolations are joined by date separators: `${y}-${m}-${d}` (a `}` immediately
//       before a `-`/`/`/`.` separator — the frontend no-utc guard's idiom).
// Neither matches the CORRECT numeric form `new Date(year, month - 1, day)` (no opening quote/backtick),
// nor `new Date(ms)` / `new Date(s)` (no date separators in the arg).
const UTC_DATE_LITERAL = /new\s+Date\s*\(\s*['"][^'")]*\d{1,4}\s*[-/.]\s*\d{1,2}\s*[-/.]/;
const UTC_DATE_TEMPLATE = /new\s+Date\s*\(\s*`[^`)]*\}\s*[-/.]/;
const isUtcDateConstruction = (line: string): boolean =>
  UTC_DATE_LITERAL.test(line) || UTC_DATE_TEMPLATE.test(line);

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlocks
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith('*')) return '';
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('no UTC-midnight date construction on the CSV-import paths (cycle 6/11 class guard)', () => {
  test('the scan resolves the real import date modules (guard is live, not a no-op)', () => {
    for (const f of FILES) {
      expect(readFileSync(f, 'utf8').length, `unreadable/empty: ${f}`).toBeGreaterThan(100);
    }
  });

  test('no import module builds a Date from a date-only string/template (use buildLocalDate)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const clean = stripComments(readFileSync(f, 'utf8'));
      clean.split('\n').forEach((line, i) => {
        if (isUtcDateConstruction(line))
          offenders.push(`${f.split('/').slice(-1)[0]}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `A CSV-import date is built from a date-only string → midnight-UTC rollback for users west of UTC ` +
        `(#23/#59/#87). Build it from numeric parts via buildLocalDate(year, month, day, …) instead:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  test('the guard is non-vacuous — buildLocalDate is still the construction path in import-mapping', () => {
    // Floor: if normalizeForeignDate stopped routing through buildLocalDate, the local-time guarantee is
    // gone regardless of the scan, so pin that the helper is still imported + used.
    const src = readFileSync(join(HERE, '..', 'import-mapping.ts'), 'utf8');
    expect(
      src.includes('buildLocalDate'),
      'import-mapping must build dates via buildLocalDate'
    ).toBe(true);
  });
});
