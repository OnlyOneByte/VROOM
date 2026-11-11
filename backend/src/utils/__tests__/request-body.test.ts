/**
 * Guard for `readJsonBody`: a body the CLIENT got wrong must answer 400, not 500.
 *
 * `c.req.json()` throws a bare SyntaxError, which is not a ZodError, HTTPException, SyncError,
 * AppError or SQLITE_ error — so an unguarded call falls through every branch of the global error
 * handler onto the generic 500 "An internal error occurred": a truncated upload or a client-side
 * JSON-building bug reads as a VROOM crash and writes an unactionable `[ERROR] Server error` line.
 * The translation belongs at the request boundary rather than in the error handler because several
 * live paths `JSON.parse` a decrypted provider credential, where a SyntaxError means a mis-keyed
 * server and really is a 500.
 *
 * Driven through the REAL HTTP stack with raw (unserialized) bodies, plus a source scan so a new
 * hand-rolled `c.req.json()` cannot reintroduce the bug class at another call site.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, json, type TestApp } from '../../test-helpers/http-client';

let ctx: TestApp;

// createTestApp dynamic-imports the whole app; from a cold module cache that can exceed bun's
// default 5s HOOK budget, which bunfig's `[test] timeout` does not raise. Give the hook headroom
// so a cold first run reports route behaviour rather than a hook timeout.
beforeEach(async () => {
  ctx = await createTestApp();
}, 20_000);
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

/**
 * Send a RAW string body — `ctx.authed` JSON.stringifies its argument, which can never produce the
 * malformed bytes under test.
 */
function rawBody(
  method: string,
  path: string,
  body: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return Promise.resolve(
    ctx.app.request(path, {
      method,
      headers: {
        Cookie: ctx.cookie,
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
        ...extraHeaders,
      },
      body,
    })
  );
}

/** Every route that parses its own JSON body, with a body that is not valid JSON. */
const MALFORMED_CASES: { name: string; send: () => Promise<Response> }[] = [
  {
    name: 'POST /api/v1/sync (truncated array)',
    send: () => rawBody('POST', '/api/v1/sync', '{"syncTypes": ["backup"'),
  },
  {
    name: 'PUT /api/v1/settings (truncated value)',
    send: () => rawBody('PUT', '/api/v1/settings', '{"theme": '),
  },
  {
    name: 'POST /api/v1/sync/restore/from-provider (truncated value)',
    send: () =>
      rawBody('POST', '/api/v1/sync/restore/from-provider', '{"sourceType": ', {
        'Idempotency-Key': 'malformed-body-key',
      }),
  },
  {
    name: 'PATCH /api/v1/auth/me (not JSON at all)',
    send: () => rawBody('PATCH', '/api/v1/auth/me', 'displayName=Nope'),
  },
  {
    name: 'PUT /api/v1/settings (empty body)',
    send: () => rawBody('PUT', '/api/v1/settings', ''),
  },
];

describe('a malformed JSON body is a client error', () => {
  for (const { name, send } of MALFORMED_CASES) {
    test(`${name} → 400`, async () => {
      const res = await send();
      const body = await json<ErrorBody>(res);

      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ValidationError');
      expect(body.error.message).toBe('Malformed JSON request body');
    });
  }

  test('a well-formed body on the same route still reaches the handler', async () => {
    // Positive control: the helper must not swallow valid input (it would be an easy way to make
    // the assertions above pass for the wrong reason).
    const res = await rawBody('PATCH', '/api/v1/auth/me', '{"displayName":"Renamed User"}');
    const body = await json<{ data: { user: { displayName: string } } }>(res);

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.user.displayName).toBe('Renamed User');
  });

  test('a well-formed body that fails validation keeps its own 400 message', async () => {
    // The helper only classifies PARSE failures — schema validation still speaks for itself.
    const res = await rawBody('POST', '/api/v1/sync', '{"syncTypes": []}');
    const body = await json<ErrorBody>(res);

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error.message).toContain('syncTypes');
  });
});

describe('a body that parses but is not an object is a client error too', () => {
  // `null`, a number and an array are all valid JSON, so they get PAST the parse guard and reach
  // code written for an object. Dereferencing one is a TypeError — a 500 for a request the client
  // got wrong, which is the same defect in a different disguise.
  const SHAPES = ['null', '5', '"nope"', '[1,2]'];

  for (const shape of SHAPES) {
    test(`POST /api/v1/sync with body ${shape} → 400`, async () => {
      const res = await rawBody('POST', '/api/v1/sync', shape);
      const body = await json<ErrorBody>(res);

      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(body.error.message).toContain('syncTypes');
    });

    test(`PUT /api/v1/settings with body ${shape} → 400`, async () => {
      const res = await rawBody('PUT', '/api/v1/settings', shape);
      expect(res.status, await res.text()).toBe(400);
    });

    test(`PATCH /api/v1/auth/me with body ${shape} → 400`, async () => {
      const res = await rawBody('PATCH', '/api/v1/auth/me', shape);
      expect(res.status, await res.text()).toBe(400);
    });

    test(`POST /api/v1/sync/restore/from-provider with body ${shape} → 400`, async () => {
      const res = await rawBody('POST', '/api/v1/sync/restore/from-provider', shape, {
        'Idempotency-Key': `shape-${shape}`,
      });
      expect(res.status, await res.text()).toBe(400);
    });
  }
});

describe('no route hand-rolls its own JSON body read', () => {
  test('every c.req.json() call site goes through readJsonBody', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

    const offenders = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
      .map((file) => file.split(sep).join('/'))
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.includes('__tests__') &&
          // The helper itself is the one legitimate call site.
          file !== 'utils/request-body.ts'
      )
      .filter((file) => /\breq\.json\(/.test(readFileSync(join(srcRoot, file), 'utf8')))
      .sort();

    expect(
      offenders,
      'A route reads its JSON body directly. `c.req.json()` throws a SyntaxError on a malformed ' +
        'body, which the global error handler can only report as a 500 — use readJsonBody(c) ' +
        "(utils/request-body.ts) or zValidator('json', schema), both of which answer 400."
    ).toEqual([]);
  });
});
