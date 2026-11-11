/**
 * Regression GUARD: a `HOST` this machine cannot bind must fail by NAME, and the default `HOST`
 * must actually serve.
 *
 * Bun's error for an address the host does not own is `EADDRINUSE — Failed to start server. Is
 * port <PORT> in use?`, so `HOST=vroom.example.com` sent operators hunting a port collision that
 * did not exist. index.ts probes the address on port 0 first — an ephemeral port is never
 * occupied, so a failure there can only be the address — and exits naming `HOST`.
 *
 * Boots the real entry point as a subprocess, because that is the only place the failure exists:
 * the error comes out of Bun's bind, not out of anything a unit test can call. `--env-file=/dev/null`
 * keeps a developer's `backend/.env` (which sets `HOST`) out of the run, so the default-HOST case
 * tests the default and not whatever the machine happens to have configured.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..');
const ENTRY = join(BACKEND_ROOT, 'src', 'index.ts');
const CONFIG_SRC = join(HERE, '..', 'config.ts');

/** RFC 5737 TEST-NET-1: never assigned to a host, so the bind fails at once and without DNS. */
const UNBINDABLE_HOST = '192.0.2.1';
const BOOT_TIMEOUT_MS = 20_000;

/** A port nothing holds: taken by binding ephemerally and releasing it again. */
function freePort(): number {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) });
  const port = probe.port ?? 0;
  probe.stop(true);
  expect(port, 'could not take an ephemeral port to test against').toBeGreaterThan(0);
  return port;
}

function spawnBackend(env: Record<string, string>) {
  return Bun.spawn([process.execPath, '--env-file=/dev/null', ENTRY], {
    cwd: BACKEND_ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'development',
      DATABASE_URL: ':memory:',
      PROVIDER_ENCRYPTION_KEY: '0'.repeat(64),
      LOG_LEVEL: 'info',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

async function outputOf(proc: ReturnType<typeof spawnBackend>): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return `${stdout}${stderr}`;
}

/** Poll until the server answers, so the test does not race a cold start. */
async function waitForHealth(url: string): Promise<number> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS / 2;
  while (Date.now() < deadline) {
    try {
      return (await fetch(url)).status;
    } catch {
      await Bun.sleep(100);
    }
  }
  return 0;
}

describe('an unbindable HOST fails by name', () => {
  test(
    'exits 1 naming HOST instead of blaming the port',
    async () => {
      const proc = spawnBackend({ HOST: UNBINDABLE_HOST, PORT: String(freePort()) });
      const exitCode = await proc.exited;
      const output = await outputOf(proc);

      expect(exitCode, `expected a failed start; output:\n${output}`).toBe(1);
      expect(
        output,
        'the startup failure must name HOST and its value, or the operator has nothing to act on'
      ).toContain(`Cannot bind HOST=${UNBINDABLE_HOST}`);
      expect(
        output,
        'nothing held the port, so a port-collision error would send the operator hunting a ' +
          'problem that does not exist'
      ).not.toMatch(/EADDRINUSE|port \d+ in use/i);
    },
    BOOT_TIMEOUT_MS
  );

  test(
    'the default HOST serves the IPv4 loopback',
    async () => {
      const port = freePort();
      const proc = spawnBackend({ PORT: String(port) });
      let status = 0;
      try {
        status = await waitForHealth(`http://127.0.0.1:${port}/health`);
      } finally {
        proc.kill();
        await proc.exited;
      }
      const output = await outputOf(proc);

      expect(
        status,
        `the default HOST must answer on 127.0.0.1 — every documented client (curl, an nginx or ` +
          `Caddy upstream, the browser in dev) reaches a loopback bind by that address. ` +
          `Child output:\n${output}`
      ).toBe(200);
      // The address probe must release its ephemeral port, never the configured one.
      expect(output).not.toContain('Cannot bind HOST');
    },
    BOOT_TIMEOUT_MS
  );

  test('the default is the loopback LITERAL, not a name and not every interface', () => {
    expect(
      /HOST: z\.string\(\)\.default\('127\.0\.0\.1'\)/.test(readFileSync(CONFIG_SRC, 'utf8')),
      "config.ts must default HOST to '127.0.0.1'. A name binds whichever loopback family the " +
        'resolver answers with first (measurably ::1 on some hosts), which refuses every client ' +
        'that dials 127.0.0.1; omitting the host binds every interface, exposing a direct install ' +
        'by default.'
    ).toBe(true);
  });
});
