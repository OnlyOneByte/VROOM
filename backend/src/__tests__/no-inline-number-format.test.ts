import { expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ratchet } from '../test-helpers/debt-ratchet';

const SRC = join(import.meta.dir, '..');
const INLINE_FORMAT = /\.toLocale(?:Date|Time)?String\(/;

function inlineFormatSites(): string[] {
  return [...new Bun.Glob('**/*.ts').scanSync({ cwd: SRC })]
    .filter((file) => !file.includes('__tests__/') && !file.startsWith('test-helpers/'))
    .filter((file) => INLINE_FORMAT.test(readFileSync(join(SRC, file), 'utf8')));
}

ratchet({
  name: 'backend messages format numbers in one place',
  kind: 'exclusion',
  scan: inlineFormatSites,
  tolerated: ['utils/money.ts'],
  guidance:
    'Format numbers in backend messages with formatNumberForMessage() from utils/money.ts ' +
    'instead of calling toLocaleString() inline:',
  probe: () => {
    expect(INLINE_FORMAT.test("max.toLocaleString('en-US')")).toBe(true);
    expect(INLINE_FORMAT.test('d.toLocaleDateString()')).toBe(true);
    expect(INLINE_FORMAT.test('formatNumberForMessage(max)')).toBe(false);
  },
});
