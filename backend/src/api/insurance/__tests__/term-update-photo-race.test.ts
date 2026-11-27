import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
import type { PhotoRef } from '../../../db/schema';
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

function premiumId(termId: string): string {
  const row = ctx.sqlite
    .query(`SELECT id FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?`)
    .get(termId) as { id: string } | null;
  return row?.id ?? '';
}

function attachReceipt(expenseId: string): void {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
     VALUES ('prov-1', ?, 'storage', 'fake', 'Fake storage', 'unused', 'active')`,
    [ctx.user.id]
  );
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES ('late-receipt', ?, 'expense', ?, 'receipt.jpg', 'image/jpeg', 1024)`,
    [ctx.user.id, expenseId]
  );
  ctx.sqlite.run(
    `INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status)
     VALUES ('late-ref', 'late-receipt', 'prov-1', 'receipts/late.jpg', 'active')`
  );
}

describe('insurance term update and a photo attached as it starts', () => {
  test('the stored file of a photo attached just before the premium replace is deleted with its row', async () => {
    const vehicleId = await seedVehicle(ctx, { nickname: 'Insured' });
    const created = await ctx.authed('POST', '/api/v1/insurance', {
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
    const policy = (await json<DataEnvelope<PolicyBody>>(created)).data;
    const termId = policy.terms[0]?.id ?? '';
    const expenseId = premiumId(termId);
    expect(expenseId, 'the costed term must materialize a premium').toBeTruthy();

    const preferences = repos().preferences;
    const write = preferences.writeAtScale.bind(preferences);
    let writes = 0;
    let attached = false;
    const atScale = spyOn(preferences, 'writeAtScale').mockImplementation((userId, scale, run) => {
      writes++;
      if (writes === 2) {
        attached = true;
        attachReceipt(expenseId);
      }
      return write(userId, scale, run);
    });
    const photoService = await import('../../photos/photo-service');
    const deleted: PhotoRef[] = [];
    const storage = spyOn(photoService, 'deleteStoredPhotoObjects').mockImplementation(
      async (refs) => {
        deleted.push(...refs);
      }
    );
    try {
      const res = await ctx.authed('PUT', `/api/v1/insurance/${policy.id}/terms/${termId}`, {
        totalCost: 1500,
      });
      expect(res.status, await res.text()).toBe(200);
      expect(writes, 'the term save, then the premium replace').toBe(2);
      expect(attached, 'the photo must be attached as the replace starts').toBe(true);
    } finally {
      atScale.mockRestore();
      storage.mockRestore();
    }

    const left = ctx.sqlite
      .query("SELECT COUNT(*) AS n FROM photos WHERE id = 'late-receipt'")
      .get();
    expect(left).toEqual({ n: 0 });
    expect(deleted.map((ref) => ref.id)).toEqual(['late-ref']);
  });
});
