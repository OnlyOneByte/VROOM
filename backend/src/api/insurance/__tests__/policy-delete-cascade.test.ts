/**
 * In-process HTTP tests for insurance POLICY deletion CASCADE — through the REAL
 * stack. Same data-integrity class as vehicle-delete-cascade: deleting a policy
 * FK-cascades its terms and claims, but the photos table links by
 * (entity_type, entity_id) strings with NO foreign key — so the policy's own
 * documents AND its claims' documents (DB rows + external storage files) would
 * be orphaned unless the route cleans them explicitly before deletion.
 *
 * These tests pin the desired behavior: after deleting a policy, NO photo rows
 * for that policy or its claims remain.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function seedPhoto(opts: { id: string; entityType: string; entityId: string }): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [opts.id, ctx.user.id, opts.entityType, opts.entityId, `${opts.id}.jpg`]
  );
}

function photoCount(entityType: string, entityId: string): number {
  const row = ctx.sqlite
    .query(`SELECT COUNT(*) AS n FROM photos WHERE entity_type = ? AND entity_id = ?`)
    .get(entityType, entityId) as { n: number };
  return row.n;
}

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function seedPolicyWithClaim(
  vehicleId: string
): Promise<{ policyId: string; claimId: string }> {
  const pol = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const polBody = await json<DataEnvelope<{ id: string }>>(pol);
  expect(pol.status, JSON.stringify(polBody)).toBe(201);
  const policyId = polBody.data.id;

  const claim = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
    claimDate: '2024-06-15T00:00:00.000Z',
    claimType: 'collision',
  });
  const claimBody = await json<DataEnvelope<{ id: string }>>(claim);
  expect(claim.status, JSON.stringify(claimBody)).toBe(201);
  return { policyId, claimId: claimBody.data.id };
}

describe('insurance policy deletion cascades photo cleanup to itself + claims', () => {
  test("deleting a policy removes its own AND its claims' photo rows (no orphans)", async () => {
    const vehicleId = await seedVehicle();
    const { policyId, claimId } = await seedPolicyWithClaim(vehicleId);

    seedPhoto({ id: 'pol-doc', entityType: 'insurance_policy', entityId: policyId });
    seedPhoto({ id: 'claim-doc', entityType: 'insurance_claim', entityId: claimId });
    expect(photoCount('insurance_policy', policyId)).toBe(1);
    expect(photoCount('insurance_claim', claimId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/insurance/${policyId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      photoCount('insurance_policy', policyId),
      'policy document photo rows should be cleaned up on policy delete'
    ).toBe(0);
    expect(
      photoCount('insurance_claim', claimId),
      'claim document photo rows should be cleaned up on policy delete'
    ).toBe(0);
  });

  test('deleting a single claim directly removes its photo rows (no orphans)', async () => {
    const vehicleId = await seedVehicle();
    const { policyId, claimId } = await seedPolicyWithClaim(vehicleId);
    seedPhoto({ id: 'claim-doc-direct', entityType: 'insurance_claim', entityId: claimId });
    expect(photoCount('insurance_claim', claimId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/insurance/${policyId}/claims/${claimId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      photoCount('insurance_claim', claimId),
      'claim photo rows should be cleaned up on direct claim delete'
    ).toBe(0);
  });
});
