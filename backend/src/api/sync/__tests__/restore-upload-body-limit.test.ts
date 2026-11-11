/**
 * Regression net for the body-size cap on the backup-RESTORE upload — the data-recovery path.
 *
 * Two body limits apply to `POST /api/v1/sync/restore/from-backup`:
 *  - the GLOBAL one in app.ts (10MB), a DoS guard sized for JSON payloads, and
 *  - the ROUTE's own (`CONFIG.backup.maxFileSize`, 50MB), sized for a whole backup ZIP.
 *
 * Middleware order makes the global one decisive: it runs first and rejects on Content-Length, so
 * a route-level allowance LARGER than the global cap is unreachable — a user with an 11MB backup
 * got 413 "Request body too large" and could not restore their own data, while the route's 50MB
 * allowance looked (in code and in docs) like it applied. app.ts therefore maps this path to the
 * larger cap; the route keeps its own matching bodyLimit as the authoritative declaration.
 *
 * What is pinned here:
 *  1. a body ABOVE the global cap but under the route's reaches the handler (no 413) — RED before
 *  the fix;
 *  2. a body above the ROUTE's cap is still rejected 413 — the entry widens the limit, it does not
 *  remove it;
 *  3. the unversioned alias still 308-redirects a large upload instead of 413-ing it;
 *  4. an ordinary route is still capped at the global 10MB — pins that the fix was not "raise the
 *  global cap for everyone";
 *  5. the inventory of route-level bodyLimit declarations, so the next one gets checked against
 *  the global cap.
 *
 * Bodies are hand-built multipart with an explicit Content-Length, because that header is what
 * bodyLimit reads — `app.request` with a FormData object does not always set it, which would make
 * the guard vacuous. Case 1 sends real bytes so the request genuinely flows through the handler
 * (the payload is not a valid ZIP, so the handler fails on its own terms — the point is the limit
 * boundary, not a real restore); the rejection cases only need the declared header.
 */

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

/** CSRF: multipart is a "simple request" content type, so hono's csrf guard checks Origin. */
const TEST_ORIGIN = 'http://localhost:3000';

/**
 * Build a multipart/form-data body (file + mode) with a payload of `fileBytes` zero bytes, and
 * return it with the exact headers a real client would send — including Content-Length.
 */
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
    const fileBytes = GLOBAL_MAX_BODY_SIZE + 1024 * 1024; // 11MB: over the global cap, under 50MB
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
    // It reached the handler, which rejected the payload on its own terms (not a valid ZIP).
    expect(body.error?.code).toBeTruthy();
  });

  test("a backup larger than the ROUTE's own cap is still rejected with 413", async () => {
    const declared = 51 * 1024 * 1024; // over CONFIG.backup.maxFileSize (50MB)
    // bodyLimit rejects on the declared header before the body is read, so no real bytes needed.
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

    // 308 preserves the method and body, so the client can follow it with the same upload.
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

  /**
   * Drift tripwire for the whole class: a route-level bodyLimit is only reachable if it is
   * TIGHTER than the global cap, so every new one has to be checked against it. This pins the
   * inventory of files that declare one — the receipt upload (8MB, tighter, nothing to do) and
   * this restore upload (50MB, which needs its app.ts entry).
   */
  test('the inventory of route-level bodyLimit declarations has not drifted', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const declaring = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
      .map((file) => file.split(sep).join('/'))
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.includes('__tests__') &&
          // app.ts declares the global cap; middleware/ is the implementation itself.
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
