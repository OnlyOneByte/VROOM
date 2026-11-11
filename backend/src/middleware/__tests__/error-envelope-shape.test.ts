/**
 * Every error response wears the same envelope.
 *
 * The contract is `{ success: false, error: { code, message, details? } }`, produced by
 * `createErrorResponse` / `formatErrorResponse` in `src/errors.ts`. The frontend switches on
 * `error.code` and shows `error.message`, so a response that omits `code` or puts something other
 * than a sentence in `message` degrades the UI to "something went wrong" — or worse, renders
 * machine detail at the user.
 *
 * Two ways that kept happening:
 *
 *  1. Hand-rolling the object literal at the `c.json(...)` call. Shape-correct today, drifts
 *     tomorrow, and there is no one place to change when the envelope gains a field.
 *  2. Letting a library shape it. `@hono/zod-validator`'s built-in failure response answers
 *     `error: { name: 'ZodError', message: <the issue array, JSON-stringified> }` — no `code`, and
 *     a `message` that is a dump of Zod internals. That is why route files import `zValidator`
 *     from `utils/validation` (which supplies a hook) rather than from the package.
 *
 * Both halves are checked: a source scan for hand-rolled envelopes and for the raw package import,
 * plus live assertions on an actual validation failure so the hook cannot silently stop running.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { ratchet } from '../../test-helpers/debt-ratchet';
import { zValidator } from '../../utils/validation';

const SRC = join(import.meta.dir, '../../');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const files = sourceFiles(SRC);
const rel = (file: string) => relative(SRC, file).split('\\').join('/');

/**
 * A `c.json({ success: false, ... })` literal — the hand-rolled envelope. Matched on the collapsed
 * source so a multi-line literal is caught too; route files split these across six lines.
 */
const HAND_ROLLED = /c\.json\(\s*\{\s*success:\s*false/;

/**
 * `src/errors.ts` is where the envelope is DEFINED, and `src/middleware/error-handler.ts` is the
 * one place allowed to pass a pre-built body through (it receives one from `syncErrorResponse`).
 */
const ENVELOPE_OWNERS = ['errors.ts', 'middleware/error-handler.ts', 'api/sync/sync-errors.ts'];

ratchet({
  name: 'error responses are built by the shared envelope helper',
  tolerated: [],
  guidance:
    'These build the error envelope by hand at the c.json() call. Use ' +
    "`createErrorResponse('CODE', 'A readable sentence.', details?)` from src/errors.ts so there " +
    'is one definition of the shape the frontend parses:',
  scan: () =>
    files
      .filter((file) => !ENVELOPE_OWNERS.some((owner) => rel(file).endsWith(owner)))
      .filter((file) => HAND_ROLLED.test(readFileSync(file, 'utf-8').replace(/\s+/g, ' ')))
      .map(rel),
  probe: () => {
    // Fixtures, not live offenders: anchoring on a real one would make this unsatisfiable once the
    // last is fixed, which is the state it is in now.
    expect(HAND_ROLLED.test('return c.json({ success: false, error: { code: "X" } }, 400);')).toBe(
      true
    );
    expect(HAND_ROLLED.test('return c.json( { success: false, error: {} }, 404 );')).toBe(true);
    expect(HAND_ROLLED.test('return c.json(createErrorResponse("X", "y"), 400);')).toBe(false);
    expect(HAND_ROLLED.test('return c.json({ success: true, data });')).toBe(false);
    expect(files.length, 'the source walk found almost nothing — SRC is wrong').toBeGreaterThan(50);
  },
});

ratchet({
  name: 'zValidator comes from utils/validation, not straight from the package',
  tolerated: [],
  guidance:
    "Importing zValidator from '@hono/zod-validator' directly skips the failure hook, so this " +
    "route's 400s answer with `error: { name: 'ZodError', message: <JSON dump> }` and no `code`. " +
    'Import it from utils/validation instead:',
  scan: () =>
    files
      .filter((file) => !rel(file).endsWith('utils/validation.ts'))
      .filter((file) => /from\s*'@hono\/zod-validator'/.test(readFileSync(file, 'utf-8')))
      .map(rel),
  probe: () => {
    const pattern = /from\s*'@hono\/zod-validator'/;
    expect(pattern.test("import { zValidator } from '@hono/zod-validator';")).toBe(true);
    expect(pattern.test("import { zValidator } from '../../utils/validation';")).toBe(false);
  },
});

describe('a live validation failure wears the envelope', () => {
  /** Exercises the hook end to end — the source scans cannot tell whether it still fires. */
  const app = new Hono().post(
    '/t',
    zValidator('json', z.object({ n: z.number(), label: z.string() })),
    (c) => c.json({ success: true })
  );

  async function failWith(body: unknown) {
    const res = await app.request('/t', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  test('a single bad field answers 400 with code, a readable message, and the issues', async () => {
    const { status, body } = await failWith({ n: 'nope', label: 'ok' });
    const error = body.error as { code: string; message: string; details: { issues: unknown[] } };

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(error.code).toBe('ValidationError');
    // The field has to be named — a message that does not say WHICH field is unactionable on a
    // multi-field form.
    expect(error.message).toContain('n');
    // And the message must not be the serialized ZodError the package would have produced.
    expect(error.message).not.toContain('"code"');
    expect(error.message.trimStart().startsWith('[')).toBe(false);
    expect(error.details.issues).toHaveLength(1);
  });

  test('several bad fields are all named in the one message', async () => {
    const { body } = await failWith({ n: 'nope' });
    const error = body.error as { message: string; details: { issues: unknown[] } };
    expect(error.message).toContain('n');
    expect(error.message).toContain('label');
    expect(error.details.issues).toHaveLength(2);
  });

  test('the target is identified, so a param failure is distinguishable from a body one', async () => {
    const paramApp = new Hono().get(
      '/v/:id',
      zValidator('param', z.object({ id: z.string().min(5) })),
      (c) => c.json({ success: true })
    );
    const res = await paramApp.request('/v/ab');
    const body = (await res.json()) as { error: { message: string } };
    expect(res.status).toBe(400);
    expect(body.error.message).toContain('param');
  });
});
