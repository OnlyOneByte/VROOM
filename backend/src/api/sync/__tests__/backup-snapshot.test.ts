import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { backupService } from '../backup';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx, { make: 'Subaru', model: 'Outback', year: 2021 });
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const WRITE_GRACE_MS = 200;

type Reader = { storageProviderIdentities: (...args: unknown[]) => Promise<unknown> };

describe('a backup reads one consistent snapshot', () => {
  test('a write sent while the backup is reading lands after it, not inside it', async () => {
    const reader = backupService as unknown as Reader;
    const read = reader.storageProviderIdentities.bind(backupService);
    const { outsideTransaction } = openAsyncDatabase(ctx.sqlite);
    let pending: Promise<Response> | undefined;
    const spy = spyOn(reader, 'storageProviderIdentities').mockImplementation(async (...args) => {
      pending = outsideTransaction(() =>
        ctx.authed('POST', '/api/v1/reminders', {
          name: 'Written mid-backup',
          type: 'notification',
          frequency: 'monthly',
          startDate: '2030-01-15T00:00:00.000Z',
          vehicleIds: [vehicleId],
        })
      );
      await Promise.race([pending, Bun.sleep(WRITE_GRACE_MS)]);
      return read(...args);
    });

    try {
      const backup = await backupService.createBackup(ctx.user.id);
      expect(backup.reminders ?? []).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
    expect((await pending)?.status).toBe(201);
    expect(
      await ctx.sql.get("SELECT COUNT(*) AS n FROM reminders WHERE name = 'Written mid-backup'")
    ).toEqual({ n: 1 });
  }, 10_000);
});
