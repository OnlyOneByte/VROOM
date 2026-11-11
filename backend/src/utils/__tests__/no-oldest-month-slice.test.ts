// Source scan: a month-key sort must not be sliced from the start, because that keeps the oldest
// months and hides the current period. Use slice(-N) for the most recent window. Numeric sorts
// followed by slice(0, N) are fine, so the regex requires localeCompare.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..');
const FILES = [
  join(SRC, 'utils', 'analytics-charts.ts'),
  join(SRC, 'api', 'analytics', 'repository.ts'),
];

// `[^;]*?` keeps the match inside one statement, so an unrelated slice(0) later in the file does
// not match.
const OLDEST_MONTH_SLICE = /localeCompare[^;]*?\.slice\(\s*0\s*,/;

describe('no oldest-month slice in analytics month series', () => {
  test('the scan resolves the source files', () => {
    for (const f of FILES) {
      expect(readFileSync(f, 'utf8').length, `unreadable/empty: ${f}`).toBeGreaterThan(100);
    }
  });

  test('no month-key sort is truncated from the start', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      // Collapse whitespace so a multi-line `.sort(...).slice(...)` chain is matched as one.
      const collapsed = readFileSync(f, 'utf8').replace(/\s+/g, ' ');
      if (OLDEST_MONTH_SLICE.test(collapsed)) {
        offenders.push(f.replace(`${SRC}/`, ''));
      }
    }
    expect(
      offenders,
      `A month-key (localeCompare) sort is sliced from the START — that keeps the OLDEST months ` +
        `and hides the current period. Use .slice(-N) for the most-recent window:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
