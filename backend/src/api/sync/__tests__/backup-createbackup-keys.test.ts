import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('createBackup output stays in sync with the registry', () => {
  test('createBackup() emits exactly the registry keys (plus metadata)', async () => {
    const { backupService } = await import('../backup');
    const { TABLE_SCHEMA_MAP } = await import('../../../config');
    const backup = await backupService.createBackup(ctx.user.id);

    const emittedKeys = Object.keys(backup)
      .filter((k) => k !== 'metadata')
      .sort();
    const registryKeys = Object.keys(TABLE_SCHEMA_MAP).sort();

    expect(
      emittedKeys,
      'createBackup() data keys must exactly equal the backup registry keys (no silent drift)'
    ).toEqual(registryKeys);
  });
});
