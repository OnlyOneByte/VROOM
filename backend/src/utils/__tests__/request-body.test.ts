// A malformed body from the client must answer 400, not 500. Driven through the real HTTP stack
// with raw bodies. The source scan at the end stops new direct c.req.json() calls from
// reintroducing the bug.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp, json, type TestApp } from '../../test-helpers/http-client';

let ctx: TestApp;

// A cold module load can exceed bun's 5s hook budget, which bunfig's test timeout does not raise.
beforeEach(async () => {
  ctx = await createTestApp();
}, 20_000);
afterEach(() => ctx.close());

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

// Sends a raw string body. ctx.authed JSON.stringifies its argument and cannot produce malformed
// JSON.
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
    // Positive control: valid bodies must still reach the handler.
    const res = await rawBody('PATCH', '/api/v1/auth/me', '{"displayName":"Renamed User"}');
    const body = await json<{ data: { user: { displayName: string } } }>(res);

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.user.displayName).toBe('Renamed User');
  });

  test('a well-formed body that fails validation keeps its own 400 message', async () => {
    // Schema failures keep their own message.
    const res = await rawBody('POST', '/api/v1/sync', '{"syncTypes": []}');
    const body = await json<ErrorBody>(res);

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error.message).toContain('syncTypes');
  });
});

describe('a body that parses but is not an object is a client error too', () => {
  // These parse as JSON but are not objects, so they must be rejected before any property access.
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
