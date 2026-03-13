/**
 * Property-Based Tests for OdometerRepository
 *
 * Property 2: Upsert idempotency
 * For any linkedEntityType+linkedEntityId pair, calling upsertFromLinkedEntity N times (N ≥ 1)
 * results in exactly one entry, and the entry ID remains stable across calls.
 * The odometer and recordedAt values reflect the most recent call's parameters.
 *
 * **Validates: Requirements 4.1, 4.2**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigrationsUpTo, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import type { NewOdometerEntry } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { OdometerRepository } from '../repository';

describe('Property 2: Upsert idempotency', () => {
  let db: Database;
  let drizzleDb: AppDatabase;
  let repo: OdometerRepository;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, migrations.length - 1);

    // Seed user and vehicle for FK constraints
    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'g1')"
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

  test('calling upsertFromLinkedEntity N times produces exactly one entry with stable ID', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 999999 }),
        fc.constantFrom('expense', 'trip'),
        fc.uuid(),
        async (n, baseOdometer, entityType, entityId) => {
          // Clean slate for each property run
          db.run('DELETE FROM odometer_entries');

          let firstId: string | null = null;

          for (let i = 0; i < n; i++) {
            const entry = await repo.upsertFromLinkedEntity({
              vehicleId: 'v1',
              userId: 'u1',
              odometer: baseOdometer + i,
              recordedAt: new Date('2024-06-15'),
              linkedEntityType: entityType,
              linkedEntityId: entityId,
            });

            if (i === 0) {
              firstId = entry.id;
            } else {
              // ID must remain stable across calls
              expect(entry.id).toBe(firstId as string);
            }
          }

          // Exactly one entry for this type+id pair
          const found = await repo.findByLinkedEntity(entityType, entityId);
          expect(found).not.toBeNull();
          expect(found?.id).toBe(firstId as string);
          // Odometer reflects the last call's value
          expect(found?.odometer).toBe((baseOdometer + n - 1) as number);

          // Verify at the raw SQL level — no duplicates
          const row = db
            .query(
              'SELECT COUNT(*) as cnt FROM odometer_entries WHERE linked_entity_type = ? AND linked_entity_id = ?'
            )
            .get(entityType, entityId) as { cnt: number };
          expect(row.cnt).toBe(1);
        }
      ),
      { numRuns: 200 }
    );
  });
});

/**
 * Property 3: Link field consistency invariant
 *
 * For any odometer entry in the database after any sequence of operations,
 * either both linkedEntityType and linkedEntityId are null (Manual_Entry),
 * or both are non-null (Linked_Entry). There is never a state where exactly one is null.
 *
 * **Validates: Requirements 5.1, 5.2, 1.5**
 */
describe('Property 3: Link field consistency invariant', () => {
  let db: Database;
  let drizzleDb: AppDatabase;
  let repo: OdometerRepository;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, migrations.length - 1);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'g1')"
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

  // Safe date arbitrary that never produces NaN — use integer timestamps then convert
  const safeDateArb = fc
    .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-12-31').getTime() })
    .map((ts) => new Date(ts));

  // Arbitrary for a single operation in the sequence
  const operationArb = fc.oneof(
    // Create a manual entry (both link fields null)
    fc.record({
      type: fc.constant('createManual' as const),
      odometer: fc.integer({ min: 0, max: 999999 }),
      recordedAt: safeDateArb,
    }),
    // Create a linked entry via upsertFromLinkedEntity (both link fields non-null)
    fc.record({
      type: fc.constant('createLinked' as const),
      odometer: fc.integer({ min: 0, max: 999999 }),
      recordedAt: safeDateArb,
      entityType: fc.constantFrom('expense', 'trip'),
      entityId: fc.uuid(),
    }),
    // Delete a linked entry
    fc.record({
      type: fc.constant('deleteLinked' as const),
      entityType: fc.constantFrom('expense', 'trip'),
      entityId: fc.uuid(),
    })
  );

  test('every entry has both link fields null or both non-null after any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(operationArb, { minLength: 1, maxLength: 15 }),
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: property-based test with inherent branching
        async (operations) => {
          // Clean slate for each property run
          db.run('DELETE FROM odometer_entries');

          // Track linked entity IDs so deleteLinked can target existing entries
          const linkedEntityIds: Array<{ entityType: string; entityId: string }> = [];

          for (const op of operations) {
            if (op.type === 'createManual') {
              await repo.create({
                vehicleId: 'v1',
                userId: 'u1',
                odometer: op.odometer,
                recordedAt: op.recordedAt,
                note: null,
                linkedEntityType: null,
                linkedEntityId: null,
              } as NewOdometerEntry);
            } else if (op.type === 'createLinked') {
              await repo.upsertFromLinkedEntity({
                vehicleId: 'v1',
                userId: 'u1',
                odometer: op.odometer,
                recordedAt: op.recordedAt,
                linkedEntityType: op.entityType,
                linkedEntityId: op.entityId,
              });
              linkedEntityIds.push({ entityType: op.entityType, entityId: op.entityId });
            } else if (op.type === 'deleteLinked') {
              // Try to delete — may or may not match an existing entry
              await repo.deleteByLinkedEntity(op.entityType, op.entityId);
            }
          }

          // Invariant: every remaining entry has both link fields null or both non-null
          const allEntries = db.query('SELECT * FROM odometer_entries').all() as Array<{
            linked_entity_type: string | null;
            linked_entity_id: string | null;
          }>;
          for (const entry of allEntries) {
            const typeNull = entry.linked_entity_type === null;
            const idNull = entry.linked_entity_id === null;
            expect(typeNull).toBe(idNull);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
