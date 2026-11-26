import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BACKEND = join(import.meta.dir, '..', '..');
const read = (rel: string) => readFileSync(join(BACKEND, rel), 'utf8');

describe('one test timeout, set in the preload', () => {
  test('the preload sets the default for tests and hooks, overridable by TEST_TIMEOUT_MS', () => {
    expect(read('src/test-helpers/preload.ts')).toMatch(
      /setDefaultTimeout\(Number\(process\.env\.TEST_TIMEOUT_MS\) \|\| 30_000\)/
    );
  });

  test('no test script passes --timeout, which the preload would silently override', () => {
    const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts;
    const withFlag = Object.entries(scripts)
      .filter(([, command]) => /\bbun test\b.*--timeout/.test(command))
      .map(([name]) => name);
    expect(withFlag).toEqual([]);
  });

  test('bunfig sets no [test] timeout, which does not reach hooks', () => {
    expect(read('bunfig.toml')).not.toMatch(/^\s*timeout\s*=/m);
  });
});
