import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { appContext, repos } from '../../../app-context';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { deleteTermExpenses } from '../hooks';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface PolicyBody {
  id: string;
  terms: Array<{ id: string }>;
}

async function seedPremium(): Promise<{ termId: string; expenseId: string }> {
  const vehicleId = await seedVehicle(ctx, { nickname: 'Insured' });
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        totalCost: 1200,
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const termId = (await json<DataEnvelope<PolicyBody>>(res)).data.terms[0]?.id ?? '';
  const row = ctx.sqlite
    .query(`SELECT id FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?`)
    .get(termId) as { id: string } | null;
  expect(row?.id, 'the costed term must materialize a premium').toBeTruthy();
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES ('prov-1', ?, 'storage', 'fake', 'Fake storage', 'unused', 'active')`,
    [ctx.user.id]
  );
  return { termId, expenseId: row?.id ?? '' };
}

function attachPhoto(expenseId: string, id: string): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, 'expense', ?, 'receipt.jpg', 'image/jpeg', 1024)`,
    [id, ctx.user.id, expenseId]
  );
  ctx.sqlite.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
     VALUES (?, ?, 'prov-1', ?, 'active')`,
    [`${id}-ref`, id, `receipts/${id}.jpg`]
  );
}

async function recordFileDeletes() {
  const photoService = await import('../../photos/photo-service');
  const files: string[] = [];
  const stored = spyOn(photoService, 'deleteStoredPhotoObjects').mockImplementation(
    async (refs) => {
      files.push(...refs.map((ref) => ref.id));
    }
  );
  const byEntity = spyOn(photoService, 'deletePhotosForEntities').mockImplementation(
    async (_type, entityIds) => {
      for (const entityId of entityIds) {
        const refs = ctx.sqlite
          .query(
            `SELECT r.id FROM photo_refs r JOIN photos p ON p.id = r.photo_id WHERE p.entity_id = ?`
          )
          .all(entityId) as Array<{ id: string }>;
        files.push(...refs.map((ref) => ref.id));
      }
    }
  );
  return {
    files,
    restore: () => {
      stored.mockRestore();
      byEntity.mockRestore();
    },
  };
}

const photoRows = () =>
  (ctx.sqlite.query('SELECT COUNT(*) AS n FROM photos').get() as { n: number }).n;

describe("deleting an insurance term's premium expenses", () => {
  test('the stored file of a photo attached as the delete starts is deleted with its row', async () => {
    const { termId, expenseId } = await seedPremium();
    let attached = false;
    const attachOnce = () => {
      if (attached) return;
      attached = true;
      attachPhoto(expenseId, 'late');
    };
    const db = appContext().asyncDb;
    const begin = db.transaction.bind(db);
    const tx = spyOn(db, 'transaction').mockImplementation(((
      ...args: Parameters<typeof db.transaction>
    ) => {
      attachOnce();
      return begin(...args);
    }) as typeof db.transaction);
    const expenseRepo = repos().expenses;
    const remove = expenseRepo.deleteBySource.bind(expenseRepo);
    const bySource = spyOn(expenseRepo, 'deleteBySource').mockImplementation((...args) => {
      attachOnce();
      return remove(...args);
    });
    const deletes = await recordFileDeletes();
    try {
      expect(await deleteTermExpenses(termId, ctx.user.id)).toBe(1);
    } finally {
      tx.mockRestore();
      bySource.mockRestore();
      deletes.restore();
    }
    expect(attached).toBe(true);
    expect(photoRows(), 'the photo row goes with its expense').toBe(0);
    expect(deletes.files, 'and so does its stored file').toEqual(['late-ref']);
  });

  test('a delete that fails keeps the expenses, their photos and their stored files', async () => {
    const { termId, expenseId } = await seedPremium();
    attachPhoto(expenseId, 'kept');
    const bySource = spyOn(repos().expenses, 'deleteBySource').mockImplementation(async () => {
      throw new Error('forced delete failure');
    });
    const deletes = await recordFileDeletes();
    try {
      await expect(deleteTermExpenses(termId, ctx.user.id)).rejects.toThrow(
        'forced delete failure'
      );
    } finally {
      bySource.mockRestore();
      deletes.restore();
    }
    const premiums = ctx.sqlite
      .query(
        `SELECT COUNT(*) AS n FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?`
      )
      .get(termId) as { n: number };
    expect(premiums.n).toBe(1);
    expect(photoRows()).toBe(1);
    expect(deletes.files, 'no stored file is deleted for expenses that stay').toEqual([]);
  });
});
