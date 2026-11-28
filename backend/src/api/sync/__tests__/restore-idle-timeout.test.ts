import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Server } from 'bun';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { backupService } from '../backup';
import { type RestoreResponse, restoreService } from '../restore';

const TEST_ORIGIN = 'http://localhost:3000';
const SLOW_MS = 6000;
const SLOW_TEST_TIMEOUT_MS = 20_000;

function upload() {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(16)], 'backup.zip', { type: 'application/zip' }));
  form.append('mode', 'preview');
  return form;
}

describe('long backup and restore requests outlive the idle timeout', () => {
  let ctx: TestApp;
  let server: Server<unknown>;
  let timeoutCalls: number[];

  beforeEach(async () => {
    ctx = await createTestApp();
    timeoutCalls = [];
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      idleTimeout: 1,
      fetch: (req, srv) =>
        ctx.app.fetch(req, {
          timeout: (r: Request, seconds: number) => {
            timeoutCalls.push(seconds);
            srv.timeout(r, seconds);
          },
        }),
    });
  }, SETUP_TIMEOUT_MS);

  afterEach(async () => {
    await server.stop(true);
    ctx.close();
  });

  const url = (path: string) => `http://127.0.0.1:${server.port}/api/v1/sync${path}`;

  test(
    'a restore that takes longer than the idle timeout still answers',
    async () => {
      const spy = spyOn(restoreService, 'restoreFromBackup').mockImplementation(async () => {
        await Bun.sleep(SLOW_MS);
        return { success: true } as unknown as RestoreResponse;
      });
      try {
        const res = await fetch(url('/restore/from-backup'), {
          method: 'POST',
          headers: { cookie: ctx.cookie, origin: TEST_ORIGIN, 'idempotency-key': 'slow-restore' },
          body: upload(),
        });
        expect(res.status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(timeoutCalls).toEqual([0]);
      } finally {
        spy.mockRestore();
      }
    },
    SLOW_TEST_TIMEOUT_MS
  );

  test(
    'a backup download that takes longer than the idle timeout still answers',
    async () => {
      const spy = spyOn(backupService, 'exportAsZip').mockImplementation(async () => {
        await Bun.sleep(SLOW_MS);
        return Buffer.from('zip');
      });
      try {
        const res = await fetch(url('/backups/download'), { headers: { cookie: ctx.cookie } });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('zip');
        expect(timeoutCalls).toEqual([0]);
      } finally {
        spy.mockRestore();
      }
    },
    SLOW_TEST_TIMEOUT_MS
  );

  test('an unauthenticated request is refused before the idle timeout is lifted', async () => {
    const spy = spyOn(restoreService, 'restoreFromBackup');
    try {
      const res = await fetch(url('/restore/from-backup'), {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'idempotency-key': 'anon-restore' },
        body: upload(),
      });
      expect(res.status).toBe(401);
      expect(spy).not.toHaveBeenCalled();
      expect(timeoutCalls).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
