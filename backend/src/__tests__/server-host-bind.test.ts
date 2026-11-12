import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = join(HERE, '..', 'index.ts');

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
