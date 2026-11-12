import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

const RESTORE_PATH = '/api/v1/sync/restore/from-backup';
const GLOBAL_MAX_BODY_SIZE = 10 * 1024 * 1024;

interface ErrorBody {
  success?: boolean;
  error?: { code?: string; message?: string };
}

const TEST_ORIGIN = 'http://localhost:3000';

function buildUpload(fileBytes: number, mode = 'preview') {
  const boundary = '----vroomRestoreBodyLimitTest';
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="backup.zip"\r\n' +
      'Content-Type: application/zip\r\n\r\n'
  );
  const tail = encoder.encode(
    `\r\n--${boundary}\r\n` +
      'Content-Disposition: form-data; name="mode"\r\n\r\n' +
      `${mode}\r\n--${boundary}--\r\n`
  );
  const body = new Uint8Array(head.length + fileBytes + tail.length);
  body.set(head, 0);
  body.set(tail, head.length + fileBytes);
  return {
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
      origin: TEST_ORIGIN,
    },
  };
}

describe('restore upload body limit', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  test('a backup LARGER than the global cap reaches the restore handler instead of a 413', async () => {
    const fileBytes = GLOBAL_MAX_BODY_SIZE + 1024 * 1024;
    const upload = buildUpload(fileBytes);
    expect(upload.body.length).toBeGreaterThan(GLOBAL_MAX_BODY_SIZE);
    expect(upload.body.length).toBeLessThan(50 * 1024 * 1024);

    const res = await ctx.app.request(RESTORE_PATH, {
      method: 'POST',
      headers: { ...upload.headers, cookie: ctx.cookie, 'idempotency-key': 'restore-over-global' },
      body: upload.body,
    });

    const body = (await res.json()) as ErrorBody;
    expect(
      res.status,
      `an ${fileBytes} byte backup must not be refused by the global body cap — ` +
        `got ${res.status} ${JSON.stringify(body)}`
    ).not.toBe(413);
    expect(body.error?.code).not.toBe('PAYLOAD_TOO_LARGE');
    expect(body.error?.code).toBeTruthy();
  });

  test("a backup larger than the ROUTE's own cap is still rejected with 413", async () => {
    const declared = 51 * 1024 * 1024;
    const res = await ctx.app.request(RESTORE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(declared),
        origin: TEST_ORIGIN,
        cookie: ctx.cookie,
        'idempotency-key': 'restore-over-route',
      },
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('the unversioned alias can still 308-redirect a large upload to the versioned path', async () => {
    const res = await ctx.app.request('/api/sync/restore/from-backup', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(GLOBAL_MAX_BODY_SIZE + 1024 * 1024),
        origin: TEST_ORIGIN,
        cookie: ctx.cookie,
        'idempotency-key': 'restore-alias',
      },
    });

    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(RESTORE_PATH);
  });

  test('an ordinary route is still capped at the global 10MB', async () => {
    const res = await ctx.app.request('/api/v1/expenses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(GLOBAL_MAX_BODY_SIZE + 1),
        origin: TEST_ORIGIN,
        cookie: ctx.cookie,
      },
      body: JSON.stringify({ vehicleId: 'x' }),
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorBody;
    expect(body.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('the inventory of route-level bodyLimit declarations has not drifted', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const declaring = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
      .map((file) => file.split(sep).join('/'))
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.includes('__tests__') &&
          file !== 'app.ts' &&
          !file.startsWith('middleware/')
      )
      .filter((file) => /bodyLimit\(\{/.test(readFileSync(join(srcRoot, file), 'utf8')))
      .sort();

    expect(
      declaring,
      'A route declared its own bodyLimit. If its maxSize is LARGER than GLOBAL_MAX_BODY_SIZE in ' +
        'app.ts, the global guard rejects the request on Content-Length before the route runs and ' +
        'the larger allowance is dead code — add the mounted path to LARGER_BODY_LIMITS there. ' +
        'Then record the file here.'
    ).toEqual(['api/providers/vlm-routes.ts', 'api/sync/routes.ts']);
  });
});
