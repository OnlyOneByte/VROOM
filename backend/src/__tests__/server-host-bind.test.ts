/**
 * Regression GUARD: the HOST setting must reach Bun's server options.
 *
 * `HOST` is parsed and validated in config.ts and surfaced as `CONFIG.server.host`, but Bun binds
 * EVERY interface unless the default export carries a `hostname`. While it was missing, an
 * operator who set `HOST=127.0.0.1` to keep the API private behind a reverse proxy still got a
 * publicly reachable port, with a successful startup log and nothing to hint otherwise — a silent
 * exposure, the worst kind of security default.
 *
 * Source-scan rather than a boot test: importing index.ts runs migrations, starts timers and a
 * sync worker, and registers signal handlers. The scan asserts the server options object passes
 * `hostname` from `CONFIG.server.host` — drop or hardcode it and this goes RED.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, '..', 'index.ts');

/** The `export default { ... }` server options object handed to Bun. */
const SERVER_OPTIONS = /export default \{([^}]*)\}/;

function indexSrc(): string {
  return readFileSync(INDEX, 'utf8');
}

function serverOptions(): string {
  const body = indexSrc().replace(/\s+/g, ' ').match(SERVER_OPTIONS)?.[1];
  expect(
    body,
    'Could not find the `export default { ... }` server options in index.ts'
  ).toBeTruthy();
  return body ?? '';
}

describe('Bun server options honor the configured HOST', () => {
  test('the scan resolves index.ts (guard is live, not a no-op)', () => {
    expect(indexSrc().length, `unreadable/empty: ${INDEX}`).toBeGreaterThan(100);
    expect(serverOptions()).toContain('fetch');
  });

  test('hostname is passed from CONFIG.server.host', () => {
    expect(
      /hostname\s*:\s*CONFIG\.server\.host\b/.test(serverOptions()),
      'index.ts must pass `hostname: CONFIG.server.host` to Bun. Without it HOST is read, ' +
        'validated and ignored, and the server binds every interface no matter what the ' +
        `operator set. Found: ${serverOptions().trim()}`
    ).toBe(true);
  });

  test('port is still passed from CONFIG.server.port (the sibling setting)', () => {
    expect(/port\s*:\s*CONFIG\.server\.port\b/.test(serverOptions())).toBe(true);
  });
});
