/**
 * Every session-cookie write and delete in auth/routes.ts and auth/utils.ts must carry the same
 * security attributes: `secure` in production, `httpOnly`, and `sameSite: 'Lax'`. The attributes are
 * hand-copied at each site, and a browser only clears a cookie when the delete attributes match.
 * Pure source scan, no DB or network.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = [join(HERE, '..', 'routes.ts'), join(HERE, '..', 'utils.ts')];

// Matches setCookie (with a value arg) and deleteCookie (without one). The attributes object has
// no nested braces, so `[^}]*` captures the whole block.
const SESSION_COOKIE =
  /(?:set|delete)Cookie\(\s*c\s*,\s*lucia\.sessionCookieName\s*,\s*(?:[^,{]*,\s*)?\{([^}]*)\}/g;

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
  test('the scan finds the session-cookie write sites', () => {
    const blocks = sessionCookieBlocks();
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
