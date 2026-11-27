import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { getStorageProviderRegistry } from '../../providers/domains/storage/registry';

let ctx: TestApp;
let deletedFiles: string[];
let restoreProvider: () => void;

beforeEach(async () => {
  ctx = await createTestApp();
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES ('prov-1', ?, 'storage', 'fake', 'Fake storage', 'unused', 'active')`,
    [ctx.user.id]
  );
  deletedFiles = [];
  const fake = {
    type: 'fake',
    delete: async ({ externalId }: { externalId: string }) => {
      deletedFiles.push(externalId);
    },
  };
  const spy = spyOn(getStorageProviderRegistry(), 'getProvider').mockResolvedValue(fake as never);
  restoreProvider = () => spy.mockRestore();
}, SETUP_TIMEOUT_MS);
afterEach(() => {
  restoreProvider();
  ctx.close();
});

function attachPhoto(entityType: string, entityId: string, id: string): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, 'p.jpg', 'image/jpeg', 1024)`,
    [id, ctx.user.id, entityType, entityId]
  );
  ctx.sqlite.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
     VALUES (?, ?, 'prov-1', ?, 'active')`,
    [`${id}-ref`, id, `photos/${id}.jpg`]
  );
}

const photoRows = () =>
  (ctx.sqlite.query('SELECT COUNT(*) AS n FROM photos').get() as { n: number }).n;

async function createExpense(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'maintenance',
    expenseAmount: 50,
    date: '2024-06-01T00:00:00.000Z',
  });
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<{ id: string }>>(res)).data.id;
}

interface DeletePath {
  name: string;
  setup: () => Promise<{ url: string; photos: number }>;
  failRows: () => { mockRestore: () => void };
}

const paths: DeletePath[] = [
  {
    name: 'an expense',
    setup: async () => {
      const id = await createExpense(await seedVehicle(ctx, { nickname: 'Car' }));
      attachPhoto('expense', id, 'e');
      return { url: `/api/v1/expenses/${id}`, photos: 1 };
    },
    failRows: () =>
      spyOn(repos().expenses, 'delete').mockRejectedValue(new Error('forced row failure')),
  },
  {
    name: 'a split expense',
    setup: async () => {
      const vehicleIds = [
        await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 }),
        await seedVehicle(ctx, { make: 'Toyota', model: 'Corolla', year: 2022 }),
      ];
      const res = await ctx.authed('POST', '/api/v1/expenses/split', {
        splitConfig: { method: 'even', vehicleIds },
        category: 'maintenance',
        date: '2024-02-01T00:00:00.000Z',
        totalAmount: 30,
      });
      const body = await json<DataEnvelope<{ groupId: string; siblings: { id: string }[] }>>(res);
      expect(res.status).toBe(201);
      for (const [i, leg] of body.data.siblings.entries())
        attachPhoto('expense', leg.id, `leg${i}`);
      return { url: `/api/v1/expenses/split/${body.data.groupId}`, photos: 2 };
    },
    failRows: () =>
      spyOn(repos().expenses, 'deleteSplitExpense').mockRejectedValue(
        new Error('forced row failure')
      ),
  },
  {
    name: 'a vehicle, with its expenses',
    setup: async () => {
      const vehicleId = await seedVehicle(ctx, { nickname: 'Gone' });
      attachPhoto('vehicle', vehicleId, 'v');
      attachPhoto('expense', await createExpense(vehicleId), 've');
      return { url: `/api/v1/vehicles/${vehicleId}`, photos: 2 };
    },
    failRows: () =>
      spyOn(repos().vehicles, 'delete').mockRejectedValue(new Error('forced row failure')),
  },
  {
    name: 'an insurance policy',
    setup: async () => {
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
      expect(res.status).toBeLessThan(300);
      const policyId = (await json<DataEnvelope<{ id: string }>>(res)).data.id;
      attachPhoto('insurance_policy', policyId, 'pol');
      return { url: `/api/v1/insurance/${policyId}`, photos: 1 };
    },
    failRows: () =>
      spyOn(repos().insurancePolicies, 'delete').mockRejectedValue(new Error('forced row failure')),
  },
];

describe('deleting something with photos', () => {
  for (const path of paths) {
    test(`${path.name}: a failed row delete keeps its photos and their stored files`, async () => {
      const { url, photos } = await path.setup();
      const spy = path.failRows();
      try {
        const res = await ctx.authed('DELETE', url);
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        spy.mockRestore();
      }
      expect(photoRows()).toBe(photos);
      expect(deletedFiles, 'no stored file is deleted while its row stays').toEqual([]);
    });

    test(`${path.name}: a delete removes its photo rows and their stored files`, async () => {
      const { url, photos } = await path.setup();
      const res = await ctx.authed('DELETE', url);
      expect(res.status, await res.text()).toBe(200);
      expect(photoRows()).toBe(0);
      expect(deletedFiles).toHaveLength(photos);
    });
  }
});
