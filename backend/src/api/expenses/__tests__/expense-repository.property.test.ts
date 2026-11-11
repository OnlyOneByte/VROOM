import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { expenses, photos } from '../../../db/schema';
import { ExpenseRepository } from '../repository';
import type { SplitConfig } from '../validation';

let sqliteDb: Database;
let db: AppDatabase;
let repo: ExpenseRepository;

const USER_ID = 'test-user-1';
const VEHICLE_IDS = ['v-1', 'v-2', 'v-3', 'v-4', 'v-5'];

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'user1@test.com', 'User One')`
  );
  for (const vid of VEHICLE_IDS) {
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${vid}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
    );
  }
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb, { schema });
  repo = new ExpenseRepository(db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

const positiveAmountArb = fc
  .double({ min: 0.01, max: 10_000, noNaN: true })
  .map((v) => Math.round(v * 100) / 100)
  .filter((v) => v >= 0.01);

const dbVehicleIdsArb = fc
  .subarray(VEHICLE_IDS, { minLength: 2, maxLength: VEHICLE_IDS.length })
  .filter((arr) => arr.length >= 2);

const dbEvenConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

const dbPercentageConfigArb: fc.Arbitrary<SplitConfig> = dbVehicleIdsArb.chain((vehicleIds) => {
  const n = vehicleIds.length;
  return fc
    .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
    .map((weights) => {
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const pcts = weights.map((w) => Math.floor((w / weightSum) * 100));
      let remainder = 100 - pcts.reduce((s, p) => s + p, 0);
      for (let i = 0; remainder > 0; i++) {
        pcts[i]++;
        remainder--;
      }
      const allocations = vehicleIds.map((vehicleId, i) => ({
        vehicleId,
        percentage: pcts[i],
      }));
      return { method: 'percentage' as const, allocations };
    });
});

const dbAbsoluteConfigArb = (totalAmount: number): fc.Arbitrary<SplitConfig> =>
  dbVehicleIdsArb.chain((vehicleIds) => {
    const n = vehicleIds.length;
    const totalCents = Math.round(totalAmount * 100);
    return fc
      .array(fc.integer({ min: 1, max: 10000 }), { minLength: n, maxLength: n })
      .map((weights) => {
        const weightSum = weights.reduce((s, w) => s + w, 0);
        const cents = weights.map((w) => Math.floor((w / weightSum) * totalCents));
        let rem = totalCents - cents.reduce((s, c) => s + c, 0);
        for (let i = 0; rem > 0; i++) {
          cents[i]++;
          rem--;
        }
        const allocations = vehicleIds.map((vehicleId, i) => ({
          vehicleId,
          amount: cents[i] / 100,
        }));
        return { method: 'absolute' as const, allocations };
      });
  });

const dbConfigAndTotalArb: fc.Arbitrary<{ config: SplitConfig; totalAmount: number }> =
  positiveAmountArb.chain((totalAmount) =>
    fc.oneof(
      dbEvenConfigArb.map((config) => ({ config, totalAmount })),
      dbPercentageConfigArb.map((config) => ({ config, totalAmount })),
      dbAbsoluteConfigArb(totalAmount).map((config) => ({ config, totalAmount }))
    )
  );

const photoCountArb = fc.integer({ min: 0, max: 5 });

const categoryArb = fc.constantFrom(
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc'
);

async function insertPhotos(
  drizzleDb: AppDatabase,
  expenseIds: string[],
  count: number
): Promise<string[]> {
  const photoIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const targetExpenseId = expenseIds[i % expenseIds.length] as string;
    const photoId = createId();
    await drizzleDb.insert(photos).values({
      id: photoId,
      userId: USER_ID,
      entityType: 'expense',
      entityId: targetExpenseId,
      fileName: `photo-${i}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: 1024,
    });
    photoIds.push(photoId);
  }
  return photoIds;
}

describe('Split expense update preserves groupId and migrates photos', () => {
  test('update preserves groupId: new siblings share the same groupId as old siblings', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        dbConfigAndTotalArb,
        categoryArb,
        async (initial, updated, category) => {
          const oldSiblings = await repo.createSplitExpense(
            {
              splitConfig: initial.config,
              category,
              date: new Date(2024, 5, 15),
              totalAmount: initial.totalAmount,
            },
            USER_ID
          );

          const originalGroupId = oldSiblings[0]?.groupId;
          expect(originalGroupId).toBeTruthy();

          const newSiblings = await repo.updateSplitExpense(
            originalGroupId as string,
            { splitConfig: updated.config, totalAmount: updated.totalAmount },
            USER_ID
          );

          for (const sibling of newSiblings) {
            expect(sibling.groupId).toBe(originalGroupId);
          }

          const dbSiblings = await db
            .select()
            .from(expenses)
            .where(eq(expenses.groupId, originalGroupId as string));

          expect(dbSiblings.length).toBe(newSiblings.length);
          for (const row of dbSiblings) {
            expect(row.groupId).toBe(originalGroupId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  test('update preserves sourceType/sourceId on the new siblings (reminder link survives an edit)', async () => {
    const reminderId = createId();

    const oldSiblings = await repo.createSplitExpense(
      {
        splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2'] },
        category: 'financial',
        date: new Date(2024, 5, 15),
        totalAmount: 150,
        sourceType: 'reminder',
        sourceId: reminderId,
      },
      USER_ID
    );
    const groupId = oldSiblings[0]?.groupId as string;
    expect(groupId).toBeTruthy();
    for (const s of oldSiblings) {
      expect(s.sourceType).toBe('reminder');
      expect(s.sourceId).toBe(reminderId);
    }

    const newSiblings = await repo.updateSplitExpense(
      groupId,
      { splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2', 'v-3'] }, totalAmount: 180 },
      USER_ID
    );

    expect(newSiblings.length).toBe(3);
    for (const s of newSiblings) {
      expect(s.sourceType).toBe('reminder');
      expect(s.sourceId).toBe(reminderId);
    }

    const dbRows = await db.select().from(expenses).where(eq(expenses.groupId, groupId));
    expect(dbRows.length).toBe(3);
    for (const row of dbRows) {
      expect(row.sourceType).toBe('reminder');
      expect(row.sourceId).toBe(reminderId);
    }
  });

  test('photos from old siblings migrate to the first new sibling', async () => {
    await fc.assert(
      fc.asyncProperty(
        dbConfigAndTotalArb,
        dbConfigAndTotalArb,
        categoryArb,
        photoCountArb,
        async (initial, updated, category, photoCount) => {
          const oldSiblings = await repo.createSplitExpense(
            {
              splitConfig: initial.config,
              category,
              date: new Date(2024, 5, 15),
              totalAmount: initial.totalAmount,
            },
            USER_ID
          );

          const originalGroupId = oldSiblings[0]?.groupId;
          expect(originalGroupId).toBeTruthy();
          const oldSiblingIds = oldSiblings.map((s) => s.id);

          const insertedPhotoIds = await insertPhotos(db, oldSiblingIds, photoCount);

          const newSiblings = await repo.updateSplitExpense(
            originalGroupId as string,
            { splitConfig: updated.config, totalAmount: updated.totalAmount },
            USER_ID
          );

          const firstNewSiblingId = newSiblings[0]?.id;

          if (insertedPhotoIds.length > 0) {
            const migratedPhotos = await db
              .select()
              .from(photos)
              .where(eq(photos.entityType, 'expense'));

            const relevantPhotos = migratedPhotos.filter((p) => insertedPhotoIds.includes(p.id));

            expect(relevantPhotos.length).toBe(insertedPhotoIds.length);

            for (const photo of relevantPhotos) {
              expect(photo.entityId).toBe(firstNewSiblingId);
              expect(photo.entityType).toBe('expense');
            }
          }

          for (const oldId of oldSiblingIds) {
            const orphaned = await db.select().from(photos).where(eq(photos.entityId, oldId));
            expect(orphaned.length).toBe(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('split delete/update is userId-scoped at the destructive write (cross-tenant safety)', () => {
  const USER_2 = 'test-user-2';

  function injectForeignSibling(groupId: string, id: string): void {
    sqliteDb.run(
      `INSERT INTO users (id, email, display_name) VALUES ('${USER_2}', 'user2@test.com', 'User Two')`
    );
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v-other', '${USER_2}', 'Honda', 'Civic', 2021)`
    );
    sqliteDb.run(
      `INSERT INTO expenses (id, user_id, vehicle_id, category, expense_amount, date, group_id)
       VALUES ('${id}', '${USER_2}', 'v-other', 'financial', 99, 1718000000, '${groupId}')`
    );
  }

  test('deleteSplitExpense(groupId, USER_ID) must NOT delete another user’s same-groupId row', async () => {
    const siblings = await repo.createSplitExpense(
      {
        splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2'] },
        category: 'financial',
        date: new Date(2024, 5, 15),
        totalAmount: 100,
      },
      USER_ID
    );
    const groupId = siblings[0]?.groupId as string;
    injectForeignSibling(groupId, 'foreign-del');

    await repo.deleteSplitExpense(groupId, USER_ID);

    const mine = await db.select().from(expenses).where(eq(expenses.userId, USER_ID));
    expect(mine.length).toBe(0);
    const foreign = await db.select().from(expenses).where(eq(expenses.id, 'foreign-del'));
    expect(foreign.length).toBe(1);
  });

  test('updateSplitExpense(groupId, USER_ID) must NOT delete another user’s same-groupId row', async () => {
    const siblings = await repo.createSplitExpense(
      {
        splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2'] },
        category: 'financial',
        date: new Date(2024, 5, 15),
        totalAmount: 100,
      },
      USER_ID
    );
    const groupId = siblings[0]?.groupId as string;
    injectForeignSibling(groupId, 'foreign-upd');

    await repo.updateSplitExpense(
      groupId,
      { splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2', 'v-3'] }, totalAmount: 120 },
      USER_ID
    );

    const foreign = await db.select().from(expenses).where(eq(expenses.id, 'foreign-upd'));
    expect(foreign.length).toBe(1);
    expect(foreign[0]?.userId).toBe(USER_2);
  });
});

describe('absolute split edit recomputes groupTotal from allocations (no stale header)', () => {
  async function createAbsolute(
    allocations: Array<{ vehicleId: string; amount: number }>
  ): Promise<string> {
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    const siblings = await repo.createSplitExpense(
      {
        splitConfig: { method: 'absolute', allocations },
        category: 'financial',
        date: new Date(2024, 5, 15),
        totalAmount: total,
      },
      USER_ID
    );
    return siblings[0]?.groupId as string;
  }

  test('absolute edit with NO totalAmount stores groupTotal = sum(new allocations), legs reconcile', async () => {
    const groupId = await createAbsolute([
      { vehicleId: 'v-1', amount: 30 },
      { vehicleId: 'v-2', amount: 30 },
    ]);

    const newSiblings = await repo.updateSplitExpense(
      groupId,
      {
        splitConfig: {
          method: 'absolute',
          allocations: [
            { vehicleId: 'v-1', amount: 40 },
            { vehicleId: 'v-2', amount: 40 },
          ],
        },
      },
      USER_ID
    );

    const legsSum = newSiblings.reduce((s, r) => s + r.expenseAmount, 0);
    expect(legsSum).toBe(80);
    for (const s of newSiblings) {
      expect(s.groupTotal).toBe(80);
    }

    const dbRows = await db.select().from(expenses).where(eq(expenses.groupId, groupId));
    expect(dbRows.length).toBe(2);
    const dbLegsSum = dbRows.reduce((s, r) => s + r.expenseAmount, 0);
    expect(dbLegsSum).toBe(80);
    for (const row of dbRows) {
      expect(row.groupTotal).toBe(80);
    }
  });

  test('absolute edit WITH a matching totalAmount is unchanged (the fix is a no-op when total is sent)', async () => {
    const groupId = await createAbsolute([
      { vehicleId: 'v-1', amount: 30 },
      { vehicleId: 'v-2', amount: 30 },
    ]);

    const newSiblings = await repo.updateSplitExpense(
      groupId,
      {
        splitConfig: {
          method: 'absolute',
          allocations: [
            { vehicleId: 'v-1', amount: 45 },
            { vehicleId: 'v-2', amount: 35 },
          ],
        },
        totalAmount: 80,
      },
      USER_ID
    );

    for (const s of newSiblings) {
      expect(s.groupTotal).toBe(80);
    }
    expect(newSiblings.reduce((s, r) => s + r.expenseAmount, 0)).toBe(80);
  });

  test('even-split edit with NO totalAmount still falls back to the stored groupTotal (fix scoped to absolute)', async () => {
    const siblings = await repo.createSplitExpense(
      {
        splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2'] },
        category: 'financial',
        date: new Date(2024, 5, 15),
        totalAmount: 60,
      },
      USER_ID
    );
    const groupId = siblings[0]?.groupId as string;

    const newSiblings = await repo.updateSplitExpense(
      groupId,
      { splitConfig: { method: 'even', vehicleIds: ['v-1', 'v-2', 'v-3'] } },
      USER_ID
    );

    expect(newSiblings.length).toBe(3);
    for (const s of newSiblings) {
      expect(s.groupTotal).toBe(60);
    }
    expect(newSiblings.reduce((s, r) => s + r.expenseAmount, 0)).toBe(60);
  });
});
