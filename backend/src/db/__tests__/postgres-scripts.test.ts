import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { NOT_ON_POSTGRES } from '../checkpoint';

const BACKEND = join(import.meta.dir, '../../..');
const PASSWORD = 's3cretPW';
const UNREACHABLE = `postgres://vroom:${PASSWORD}@127.0.0.1:1/cars`;

function runScript(script: string, args: string[] = []) {
  const run = Bun.spawnSync(['bun', '--env-file=/dev/null', 'run', script, ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: UNREACHABLE, NODE_ENV: 'test' },
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: run.exitCode, output: `${run.stdout}${run.stderr}` };
}

describe('maintenance scripts on Postgres', () => {
  test.each([[[]], [['--force']]])(
    'the WAL checkpoint script %p says it is SQLite-only and exits cleanly',
    (args) => {
      const { code, output } = runScript('src/db/checkpoint.ts', args);
      expect(code, output).toBe(0);
      expect(output).toContain(NOT_ON_POSTGRES);
      expect(output).not.toContain('failed');
    }
  );

  test('the key rotation script opens Postgres first, so an unreachable server is named', () => {
    const { code, output } = runScript('src/scripts/rotate-provider-keys.ts');
    expect(code).not.toBe(0);
    expect(output).toContain('Could not connect to Postgres at 127.0.0.1:1/cars');
    expect(output).not.toContain('opens during startup migrations');
    expect(output).not.toContain(PASSWORD);
  }, 40_000);
});
