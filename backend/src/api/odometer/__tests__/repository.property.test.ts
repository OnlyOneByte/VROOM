/**
 * Property-Based Tests for OdometerRepository (v2)
 *
 * v2 odometer entries are manual-only — no linked entity fields.
 * The UNION query history is tested in odometer-history.property.test.ts.
 *
 * Property: Manual odometer entry CRUD round-trip
 * For any valid odometer entry data, creating an entry and reading it back
 * should produce consistent results.
 *
 * **Validates: Requirements 6.1, 6.2**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { OdometerRepository } from '../repository';

describe('Odometer repository: manual entry CRUD', () => {
  let db: Database;
  let drizzleDb: AppDatabase;
  let repo: OdometerRepository;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, migrations.length - 1);

    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );

    drizzleDb = drizzle(db, { schema });
    repo = new OdometerRepository(drizzleDb);
  });

  afterEach(() => {
    db.close();
  });

  test('create and findById round-trip preserves odometer value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 999999 }), async (odometerValue) => {
        db.run('DELETE FROM odometer_entries');

        const entry = await repo.create({
          vehicleId: 'v1',
          userId: 'u1',
          odometer: odometerValue,
          recordedAt: new Date('2024-06-15'),
          note: null,
        });

        expect(entry.odometer).toBe(odometerValue);
        expect(entry.vehicleId).toBe('v1');
        expect(entry.userId).toBe('u1');

        const found = await repo.findById(entry.id);
        expect(found).not.toBeNull();
        expect(found?.odometer).toBe(odometerValue);
      }),
      { numRuns: 50 }
    );
  });

  test('v2 odometer_entries table has no linked_entity columns', () => {
    const cols = db.query("PRAGMA table_info('odometer_entries')").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('linked_entity_type');
    expect(colNames).not.toContain('linked_entity_id');
    expect(colNames).toContain('user_id');
  });
});
