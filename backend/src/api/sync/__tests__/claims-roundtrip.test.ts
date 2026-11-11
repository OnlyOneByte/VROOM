// Insurance claims must survive a real export and restore with their fields intact.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedPolicy(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

interface ClaimRowDb {
  id: string;
  policy_id: string;
  vehicle_id: string | null;
  claim_type: string;
  status: string;
  payout_amount: number | null;
  fault_designation: string | null;
  description: string | null;
}

function claimRows(): ClaimRowDb[] {
  return ctx.sqlite.query('SELECT * FROM insurance_claims').all() as ClaimRowDb[];
}

describe('backup → restore round-trip preserves insurance claims', () => {
  test('a filed claim survives export + restore with its fields intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const policyId = await seedPolicy(vehicleId);

    const created = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
      status: 'settled',
      payoutAmount: 1234.56,
      faultDesignation: 'not_at_fault',
      description: 'Rear-ended at a light',
      vehicleId,
    });
    const createdBody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const claimId = createdBody.data.id;
    expect(claimRows()).toHaveLength(1);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.insuranceClaims, 'restore summary counts the claim').toBe(1);

    const rows = claimRows();
    expect(rows, 'exactly one claim after restore (no dup, no loss)').toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(claimId);
    expect(row.policy_id).toBe(policyId);
    expect(row.vehicle_id).toBe(vehicleId);
    expect(row.claim_type).toBe('collision');
    expect(row.status).toBe('settled');
    expect(row.payout_amount).toBe(123456);
    expect(row.fault_designation).toBe('not_at_fault');
    expect(row.description).toBe('Rear-ended at a light');
  });

  // The restore validator once rejected insurance_claim photos, aborting the whole restore. The photo
  // row is seeded directly because the upload route is multipart and the validator is under test.
  test('a photo attached to an insurance claim survives the round-trip without aborting restore', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const policyId = await seedPolicy(vehicleId);

    const created = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
    });
    const createdBody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const claimId = createdBody.data.id;

    ctx.sqlite.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-claim-1', ?, 'insurance_claim', ?, 'damage.jpg', 'image/jpeg', 2048)`,
      [ctx.user.id, claimId]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const photoRows = ctx.sqlite
      .query("SELECT id, entity_type, entity_id FROM photos WHERE entity_type = 'insurance_claim'")
      .all() as { id: string; entity_type: string; entity_id: string }[];
    expect(photoRows, 'the claim photo survived restore').toHaveLength(1);
    expect(photoRows[0].id).toBe('photo-claim-1');
    expect(photoRows[0].entity_id).toBe(claimId);
  });

  test('multiple claims on a policy all survive the round-trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const policyId = await seedPolicy(vehicleId);

    for (const t of ['collision', 'theft', 'weather']) {
      const r = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
        claimDate: '2024-06-15T00:00:00.000Z',
        claimType: t,
      });
      expect(r.status, await r.text()).toBe(201);
    }
    expect(claimRows()).toHaveLength(3);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.insuranceClaims).toBe(3);
    expect(claimRows()).toHaveLength(3);
    expect(
      claimRows()
        .map((r) => r.claim_type)
        .sort()
    ).toEqual(['collision', 'theft', 'weather']);
  });
});

// The upload allowlist and the restore validator's entity-type map are separate lists. Every type
// the upload path accepts must round-trip, or a photo of that type aborts the whole restore.
describe('a photo on every upload-accepted entity type survives backup→restore', () => {
  test('vehicle / insurance_policy / insurance_claim / expense / odometer_entry photos all round-trip', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const policyId = await seedPolicy(vehicleId);

    const claimRes = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
    });
    const claimBody = await json<DataEnvelope<{ id: string }>>(claimRes);
    expect(claimRes.status, JSON.stringify(claimBody)).toBe(201);
    const claimId = claimBody.data.id;

    const expRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-01T00:00:00.000Z',
    });
    const expBody = await json<DataEnvelope<{ id: string }>>(expRes);
    expect(expRes.status, JSON.stringify(expBody)).toBe(201);
    const expenseId = expBody.data.id;

    const odoRes = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 12345,
      recordedAt: '2024-06-01T00:00:00.000Z',
    });
    const odoBody = await json<DataEnvelope<{ id: string }>>(odoRes);
    expect(odoRes.status, JSON.stringify(odoBody)).toBe(201);
    const odometerId = odoBody.data.id;

    const targets: [entityType: string, entityId: string][] = [
      ['vehicle', vehicleId],
      ['insurance_policy', policyId],
      ['insurance_claim', claimId],
      ['expense', expenseId],
      ['odometer_entry', odometerId],
    ];
    for (const [i, [entityType, entityId]] of targets.entries()) {
      ctx.sqlite.run(
        `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
         VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
        [`photo-${i}`, ctx.user.id, entityType, entityId, `pic-${i}.jpg`]
      );
    }

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    // Fails if any upload-accepted type is missing from the validator's map.
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    const rows = ctx.sqlite
      .query('SELECT entity_type, entity_id FROM photos ORDER BY id')
      .all() as { entity_type: string; entity_id: string }[];
    expect(rows).toHaveLength(5);
    const byType = new Map(rows.map((r) => [r.entity_type, r.entity_id]));
    expect(byType.get('vehicle')).toBe(vehicleId);
    expect(byType.get('insurance_policy')).toBe(policyId);
    expect(byType.get('insurance_claim')).toBe(claimId);
    expect(byType.get('expense')).toBe(expenseId);
    expect(byType.get('odometer_entry')).toBe(odometerId);
  });
});
