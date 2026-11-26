import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import type { BackupStrategyResult } from '../backup-strategy';

let ctx: TestApp;
let finishWork: Array<() => void>;
let restoreTimeout: () => void;

beforeEach(async () => {
  ctx = await createTestApp();
  finishWork = [];
  const { encrypt } = await import('../../../utils/encryption');
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
     VALUES ('p-hang', ?, 'storage', 'fake-hang', 'Hang', ?, '{}', 'active')`,
    [
      ctx.user.id,
      encrypt(JSON.stringify({ refreshToken: 'fake' }), {
        rowId: 'p-hang',
        userId: ctx.user.id,
        domain: 'storage',
      }),
    ]
  );
  ctx.sqlite.run('INSERT OR REPLACE INTO user_preferences (user_id, backup_config) VALUES (?, ?)', [
    ctx.user.id,
    JSON.stringify({
      providers: { 'p-hang': { enabled: true, folderPath: 'B', retentionCount: 5 } },
    }),
  ]);
  const { backupStrategyRegistry } = await import('../backup-strategy-registry');
  backupStrategyRegistry.register('fake-hang', {
    execute: () =>
      new Promise<BackupStrategyResult>((resolve) => {
        finishWork.push(() => resolve({ success: true, capabilities: {} }));
      }),
  });
  const timeoutModule = await import('../../../utils/timeout');
  const spy = spyOn(timeoutModule, 'withTimeout').mockImplementation(
    <T>(work: Promise<T>) =>
      Promise.race([work, Promise.reject(new Error('timed out'))]) as Promise<T>
  );
  restoreTimeout = () => spy.mockRestore();
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  restoreTimeout();
  for (const finish of finishWork) finish();
  ctx.close();
});

async function run(): Promise<{ status?: string; outcome: string }> {
  const { backupOrchestrator } = await import('../backup-orchestrator');
  return backupOrchestrator.execute(ctx.user.id, 'Test User', true);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('backup lock', () => {
  test('a timed-out run keeps the lock until its work really stops', async () => {
    const first = await run();
    expect(first.outcome).toBe('failed');

    expect((await run()).status, 'the hung work still owns the lock').toBe('in_progress');

    finishWork[0]();
    await settle();
    const next = await run();
    expect(next.status).toBeUndefined();
  });

  test('a stale run finishing late does not release a newer run’s lock', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await run();
      const { OPERATION_TIMEOUTS } = await import('../../../utils/timeout');
      clock.mockReturnValue(1_000_000 + 2 * OPERATION_TIMEOUTS.BACKUP + 1);
      const second = await run();
      expect(second.status, 'the expired lock is taken over').toBeUndefined();

      finishWork[0]();
      await settle();

      expect((await run()).status, 'the newer run still holds its lock').toBe('in_progress');
    } finally {
      clock.mockRestore();
    }
  });

  test('the lock outlives the backup timeout', async () => {
    const clock = spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await run();
      const { OPERATION_TIMEOUTS } = await import('../../../utils/timeout');
      clock.mockReturnValue(1_000_000 + OPERATION_TIMEOUTS.BACKUP + 1);
      expect((await run()).status).toBe('in_progress');
    } finally {
      clock.mockRestore();
    }
  });
});
