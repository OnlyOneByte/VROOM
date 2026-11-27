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

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface PolicyBody {
  id: string;
  terms: Array<{ id: string }>;
}

function premiumIds(termId: string): string[] {
  const rows = ctx.sqlite
    .query(`SELECT id FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?`)
    .all(termId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function seedReceipt(expenseId: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES ('prov-1', ?, 'storage', 'fake', 'Fake storage', 'unused', 'active')`,
    [ctx.user.id]
  );
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('receipt-1', ?, 'expense', ?, 'receipt.jpg', 'image/jpeg', 1024)`,
    [ctx.user.id, expenseId]
  );
  ctx.sqlite.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
     VALUES ('ref-1', 'receipt-1', 'prov-1', 'receipts/receipt-1.jpg', 'pending')`
  );
}

function photoCount(): number {
  const row = ctx.sqlite.query('SELECT COUNT(*) AS n FROM photos').get() as { n: number };
  return row.n;
}

async function expectReceiptFilesDeleted(expenseId: string, request: () => Promise<Response>) {
  const photoService = await import('../../photos/photo-service');
  const spy = spyOn(photoService, 'deleteStoredPhotoObjects');
  try {
    const res = await request();
    expect(res.status, await res.text()).toBe(200);
    const refIds = spy.mock.calls.flatMap(([refs]) => refs.map((ref) => ref.id));
    expect(refIds, `the stored file of ${expenseId}'s receipt is deleted`).toContain('ref-1');
    expect(photoCount()).toBe(0);
  } finally {
    spy.mockRestore();
  }
}

async function createPolicy(vehicleId: string): Promise<Response> {
  return ctx.authed('POST', '/api/v1/insurance', {
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
}

async function seedCostedTerm(): Promise<{ policyId: string; termId: string; expenseId: string }> {
  const vehicleId = await seedVehicle(ctx, { nickname: 'Insured' });
  const res = await createPolicy(vehicleId);
  const body = await json<DataEnvelope<PolicyBody>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  const termId = body.data.terms[0]?.id as string;
  const [expenseId] = premiumIds(termId);
  expect(expenseId, 'the costed term must materialize a premium').toBeTruthy();
  return { policyId: body.data.id, termId, expenseId: expenseId as string };
}

describe('insurance term premium expense lifecycle', () => {
  test('a failed premium create rolls the new policy back instead of answering 201', async () => {
    const vehicleId = await seedVehicle(ctx);
    const spy = spyOn(repos().expenses, 'createSplitExpense').mockImplementation(() => {
      throw new Error('forced create failure');
    });

    try {
      const res = await createPolicy(vehicleId);
      const body = await json<{ success: boolean; error?: { message: string } }>(res);
      expect(res.status, JSON.stringify(body)).toBe(500);
      expect(body.error?.message).toContain('nothing was saved');
      const policies = ctx.sqlite.query('SELECT COUNT(*) AS n FROM insurance_policies').get() as {
        n: number;
      };
      expect(policies.n, 'a retry must not leave a duplicate policy behind').toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  test('a failed premium create on an added term removes that term', async () => {
    const { policyId } = await seedCostedTerm();
    const vehicleId = await seedVehicle(ctx, { nickname: 'Second' });
    const spy = spyOn(repos().expenses, 'createSplitExpense').mockImplementation(() => {
      throw new Error('forced create failure');
    });

    try {
      const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/terms`, {
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
        totalCost: 1300,
        vehicleCoverage: { vehicleIds: [vehicleId] },
      });
      expect(res.status, await res.text()).toBe(500);
      const terms = ctx.sqlite
        .query('SELECT COUNT(*) AS n FROM insurance_terms WHERE policy_id = ?')
        .get(policyId) as { n: number };
      expect(terms.n).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('re-saving an unchanged term recreates a premium that failed to materialize', async () => {
    const { policyId, termId, expenseId } = await seedCostedTerm();
    ctx.sqlite.run('DELETE FROM expenses WHERE id = ?', [expenseId]);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      agentName: 'Pat',
    });
    expect(res.status).toBe(200);
    expect(premiumIds(termId).length).toBe(1);
  });

  test('editing only contact details keeps the premium expense and its receipt', async () => {
    const { policyId, termId, expenseId } = await seedCostedTerm();
    seedReceipt(expenseId);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      agentPhone: '555-0100',
      coverageDescription: 'Full coverage',
    });
    expect(res.status, await res.text()).toBe(200);
    expect(premiumIds(termId)).toEqual([expenseId]);
    expect(photoCount()).toBe(1);
  });

  test('changing the cost regenerates the premium', async () => {
    const { policyId, termId, expenseId } = await seedCostedTerm();

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 1500,
    });
    expect(res.status).toBe(200);
    const ids = premiumIds(termId);
    expect(ids.length).toBe(1);
    expect(ids[0]).not.toBe(expenseId);
  });

  test('deleting a term removes its premium receipts through the photo service', async () => {
    const { policyId, termId, expenseId } = await seedCostedTerm();
    seedReceipt(expenseId);

    await expectReceiptFilesDeleted(expenseId, () =>
      ctx.authed('DELETE', `/api/v1/insurance/${policyId}/terms/${termId}`)
    );
    expect(premiumIds(termId)).toEqual([]);
  });

  test('deleting a policy removes its premium receipts through the photo service', async () => {
    const { policyId, expenseId } = await seedCostedTerm();
    seedReceipt(expenseId);

    await expectReceiptFilesDeleted(expenseId, () =>
      ctx.authed('DELETE', `/api/v1/insurance/${policyId}`)
    );
  });
});
