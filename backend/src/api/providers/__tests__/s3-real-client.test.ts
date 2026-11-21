import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = join(BACKEND_ROOT, 'src', 'test-helpers', 's3-real-client.ts');

interface FixtureResult {
  healthy: boolean;
  key: string;
  downloaded: string;
  listed: string[];
  seen: {
    method: string;
    path: string;
    host: string | null;
    signed: boolean;
    bodyLength: number;
  }[];
}

describe('the real S3 client through the outbound request handler', () => {
  test('signs, pins and round-trips every call in a process with no S3 module mocks', async () => {
    const proc = Bun.spawn([process.execPath, '--env-file=/dev/null', FIXTURE], {
      cwd: BACKEND_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        DATABASE_URL: ':memory:',
        PROVIDER_ENCRYPTION_KEY: '0'.repeat(64),
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 20_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as FixtureResult;

    expect(result.healthy).toBe(true);
    expect(result.key).toBe('receipts/receipt.jpg');
    expect(result.downloaded).toBe('real s3 client bytes');
    expect(result.listed).toEqual(['receipts/receipt.jpg']);
    expect(result.seen.map((r) => `${r.method} ${r.path}`)).toEqual([
      'HEAD /photos/',
      'PUT /photos/receipts/receipt.jpg',
      'GET /photos/receipts/receipt.jpg',
      'GET /photos/',
      'DELETE /photos/receipts/receipt.jpg',
    ]);
    expect(result.seen.every((r) => r.signed && r.host?.startsWith('s3.test:'))).toBe(true);
    expect(result.seen[1]?.bodyLength).toBe('real s3 client bytes'.length);
  });
});
