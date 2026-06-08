/**
 * Drift guard (part B): createBackup()'s emitted data-keys must EXACTLY equal the backup
 * registry keys (TABLE_SCHEMA_MAP). See backup-table-coverage.test.ts for parts A (schema
 * coverage) and the rationale.
 *
 * Why this matters: createBackup() is hand-written per-table queries that populate the export
 * object; exportAsZip then serializes each key it finds via TABLE_SCHEMA_MAP[key]. These are
 * two independent lists. A createBackup query with no registry entry is silently dropped on
 * export; a registry entry with no createBackup query is never in the object to serialize.
 * Both are silent backup data loss. This pins them equal.
 *
 * createTestApp() rewrites process.env then dynamic-imports DB-bound modules, so this file
 * keeps static imports to the harness + bun:test (+ the pure config) and imports backup
 * dynamically AFTER createTestApp, exactly like claims-roundtrip.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('createBackup output stays in sync with the registry (drift guard — cycle 208)', () => {
  test('createBackup() emits exactly the registry keys (plus metadata)', async () => {
    // Import BOTH the service and the registry dynamically — a static `config` import would
    // pull the DB-bound singleton before createTestApp() rewrites DATABASE_URL to :memory:,
    // binding to the persistent dev DB (which fails seeding on a duplicate user email).
    const { backupService } = await import('../backup');
    const { TABLE_SCHEMA_MAP } = await import('../../../config');
    // An empty user is sufficient — each table query returns [], but the KEY is still present,
    // which is exactly what this guard checks (the object's shape, not its contents).
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
