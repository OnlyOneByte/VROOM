import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { connect } from 'node:net';
import type { Server } from 'bun';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { SERVER_IDLE_TIMEOUT_SECONDS } from '../../../utils/timeout';
import { backupService } from '../backup';
import { backupOrchestrator } from '../backup-orchestrator';
import { type RestoreResponse, restoreService } from '../restore';

const TEST_ORIGIN = 'http://localhost:3000';
const TEST_IDLE_SECONDS = 1;
const SLOW_MS = 6000;
const SLOW_TEST_TIMEOUT_MS = 20_000;
const CLOSE_WAIT_MS = 12_000;

function upload() {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(16)], 'backup.zip', { type: 'application/zip' }));
  form.append('mode', 'preview');
  return form;
}

function withinMs<T>(ms: number, promise: Promise<T>): Promise<T | 'timed out'> {
  return Promise.race([promise, Bun.sleep(ms).then(() => 'timed out' as const)]);
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
      idleTimeout: TEST_IDLE_SECONDS,
      fetch: (req, srv) =>
        ctx.app.fetch(req, {
          timeout: (r: Request, seconds: number) => {
            timeoutCalls.push(seconds);
            srv.timeout(r, seconds === SERVER_IDLE_TIMEOUT_SECONDS ? TEST_IDLE_SECONDS : seconds);
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
        expect(timeoutCalls).toEqual([0, SERVER_IDLE_TIMEOUT_SECONDS]);
      } finally {
        spy.mockRestore();
      }
    },
    SLOW_TEST_TIMEOUT_MS
  );

  test(
    'a backup run that takes longer than the idle timeout still answers',
    async () => {
      const spy = spyOn(backupOrchestrator, 'execute').mockImplementation(async () => {
        await Bun.sleep(SLOW_MS);
        return { status: 'completed', outcome: 'success' } as never;
      });
      try {
        const res = await fetch(url(''), {
          method: 'POST',
          headers: { cookie: ctx.cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify({ syncTypes: ['backup'] }),
        });
        expect(res.status).toBe(200);
        expect(timeoutCalls).toEqual([0, SERVER_IDLE_TIMEOUT_SECONDS]);
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
        expect(timeoutCalls).toEqual([0, SERVER_IDLE_TIMEOUT_SECONDS]);
      } finally {
        spy.mockRestore();
      }
    },
    SLOW_TEST_TIMEOUT_MS
  );

  test(
    'a kept-alive connection gets the idle timeout back once the response is sent',
    async () => {
      const spy = spyOn(backupService, 'exportAsZip').mockResolvedValue(Buffer.from('zip'));
      const socket = connect(server.port as number, '127.0.0.1');
      try {
        let received = '';
        socket.on('data', (chunk) => {
          received += chunk.toString();
        });
        const closed = new Promise<'closed'>((resolve) =>
          socket.on('close', () => resolve('closed'))
        );
        socket.write(
          'GET /api/v1/sync/backups/download HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
            `Cookie: ${ctx.cookie}\r\nConnection: keep-alive\r\n\r\n`
        );
        expect(await withinMs(CLOSE_WAIT_MS, closed)).toBe('closed');
        expect(received.startsWith('HTTP/1.1 200')).toBe(true);
        expect(timeoutCalls).toEqual([0, SERVER_IDLE_TIMEOUT_SECONDS]);
      } finally {
        socket.destroy();
        spy.mockRestore();
      }
    },
    SLOW_TEST_TIMEOUT_MS
  );

  test(
    'an upload that stalls is still closed at the idle timeout',
    async () => {
      const spy = spyOn(restoreService, 'restoreFromBackup');
      const encoder = new TextEncoder();
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('--stall\r\nContent-Disposition: form-data; '));
        },
      });
      try {
        const outcome = await withinMs(
          CLOSE_WAIT_MS,
          fetch(url('/restore/from-backup'), {
            method: 'POST',
            headers: {
              cookie: ctx.cookie,
              origin: TEST_ORIGIN,
              'idempotency-key': 'stalled-restore',
              'content-type': 'multipart/form-data; boundary=stall',
            },
            body: stalled,
          }).then(
            (res) => `status ${res.status}`,
            () => 'closed'
          )
        );
        expect(outcome).not.toBe('timed out');
        expect(spy).not.toHaveBeenCalled();
        expect(timeoutCalls).toEqual([]);
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
