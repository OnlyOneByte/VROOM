/**
 * Regression GUARD (committed, travels with the merge) for the session-cookie SECURITY ATTRIBUTES
 * (deep-review-adjacent, C92/C97 flagged the session/cookie lifecycle unaudited).
 *
 * Every place the app writes the Lucia session cookie must set the SAME three security attributes, or
 * that auth path silently ships a weaker cookie:
 *   - `secure: CONFIG.env === 'production'` — HTTPS-only in prod (a hardcoded `true` breaks local-http
 *     dev so the cookie never sets → no login; a hardcoded `false` ships a plaintext-transmittable
 *     session cookie in production → network theft).
 *   - `httpOnly: true` — JS can't read it (defeats XSS session-token exfiltration). Dropping it on ONE
 *     path makes the session readable from script on that path.
 *   - `sameSite: 'Lax'` — the cookie isn't sent on cross-site sub-requests (CSRF defense alongside the
 *     csrf() middleware).
 *
 * These attributes are hand-duplicated across every MANUAL session-cookie call site — both the SETs
 * (auth/routes.ts login, auth/utils.ts validateAndRefreshSession's rotation) AND the DELETEs (auth/routes.ts
 * logout + the two callback cleanup paths). Lucia's own cookie config (lucia.ts) covers the framework-issued
 * path, but every manual set/delete re-states the attributes, coupled only by copy-paste. The delete attrs
 * are load-bearing too: a browser only clears a cookie when the delete's path/secure/sameSite MATCH the
 * original, so a drifted deleteCookie silently fails to log the user out. NO test asserted any of them:
 * validate-and-refresh-session.test.ts mocks Lucia and checks the rotation/return value, never the `c`
 * cookie attributes. A drift on one site (a refactor hardcoding `secure: true`, or omitting httpOnly on the
 * refresh cookie) silently weakens auth on that path, invisible to every behavioral test (the happy-path
 * login still works).
 *
 * This guard source-scans both files: every `set/deleteCookie(c, lucia.sessionCookieName, …, { … })` block
 * must carry `secure: CONFIG.env === 'production'`, `httpOnly: true`, and `sameSite: 'Lax'`. Edit any site
 * out of contract → RED. The one-edit→source-scan pattern (C25/C45/C59/C67/C80/C87/C94).
 *
 * Pure source scan — no DB, no network. Runs in the fast suite.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = [join(HERE, '..', 'routes.ts'), join(HERE, '..', 'utils.ts')];

// Extract each session-cookie write's attribute body. Matches BOTH `setCookie(c, sessionCookieName, <id>,
// { … })` (4-arg, with a value) and `deleteCookie(c, sessionCookieName, { … })` (3-arg, no value) — the
// optional `(?:[^,{]*,\s*)?` is the id arg. The attrs object has no nested braces, so `[^}]*` to the
// closing brace captures the full block.
const SESSION_COOKIE =
  /(?:set|delete)Cookie\(\s*c\s*,\s*lucia\.sessionCookieName\s*,\s*(?:[^,{]*,\s*)?\{([^}]*)\}/g;

// The three required security attributes (whitespace-insensitive after collapse).
const REQUIRED = [
  {
    name: 'secure: CONFIG.env === "production"',
    re: /secure\s*:\s*CONFIG\.env\s*===\s*'production'/,
  },
  { name: 'httpOnly: true', re: /httpOnly\s*:\s*true/ },
  { name: "sameSite: 'Lax'", re: /sameSite\s*:\s*'Lax'/ },
];

function sessionCookieBlocks(): { file: string; body: string }[] {
  const blocks: { file: string; body: string }[] = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    for (const m of src.matchAll(SESSION_COOKIE)) {
      blocks.push({ file: file.split('/').slice(-2).join('/'), body: m[1] ?? '' });
    }
  }
  return blocks;
}

describe('session-cookie security attributes are uniform across every manual setCookie site', () => {
  test('the scan finds the session-cookie setCookie sites (guard is live, not a no-op)', () => {
    const blocks = sessionCookieBlocks();
    // 2 setCookie (login routes.ts + rotation utils.ts) + 3 deleteCookie (logout + 2 callback cleanups,
    // routes.ts) = 5 today.
    expect(
      blocks.length,
      'expected ≥5 `set/deleteCookie(c, lucia.sessionCookieName, …)` sites across auth/routes.ts + auth/utils.ts; ' +
        'if the cookie write was refactored, update this guard to match the new shape'
    ).toBeGreaterThanOrEqual(5);
  });

  for (const { name, re } of REQUIRED) {
    test(`every session-cookie write sets ${name}`, () => {
      const offenders = sessionCookieBlocks().filter((b) => !re.test(b.body));
      expect(
        offenders.map((o) => `${o.file}: ${o.body.trim().slice(0, 100)}`),
        `A session-cookie setCookie site is missing/altered \`${name}\`. All session-cookie writes must ` +
          `carry the identical security attributes — a drift on one auth path silently ships a weaker ` +
          `cookie (insecure transport / JS-readable / CSRF-exposed), invisible to a happy-path login test.`
      ).toEqual([]);
    });
  }
});
