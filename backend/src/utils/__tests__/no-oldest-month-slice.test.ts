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
