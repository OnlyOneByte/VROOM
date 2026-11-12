import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = [
  join(HERE, '..', 'import-mapping.ts'),
  join(HERE, '..', 'local-date.ts'),
  join(HERE, '..', 'import-csv.ts'),
];

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

describe('no UTC-midnight date construction on the CSV-import paths', () => {
  test('the scan resolves the real import date modules', () => {
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
      `A CSV-import date is built from a date-only string → midnight-UTC rollback for users west of UTC. ` +
        `Build it from numeric parts via buildLocalDate(year, month, day, …) instead:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  test('import-mapping still constructs dates with buildLocalDate', () => {
    const src = readFileSync(join(HERE, '..', 'import-mapping.ts'), 'utf8');
    expect(
      src.includes('buildLocalDate'),
      'import-mapping must build dates via buildLocalDate'
    ).toBe(true);
  });
});
