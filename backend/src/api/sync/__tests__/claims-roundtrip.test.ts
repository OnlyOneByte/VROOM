/**
 * TRUE backup → restore round-trip for insurance claims, through the REAL stack.
 *
 * insurance_claims was threaded through the backup/restore pipeline by hand
 * across many files (config maps, backup query + referential-integrity, restore
 * FK-ordered insert + ImportSummary, sheets service). Existing tests cover
 * validation / ref-integrity (backup.test) and MOCKED orchestration
 * (unified-restore) — but nothing proved a real export → import preserves a
 * claim. This does: seed a vehicle + policy + fully-populated claim via the real
 * API, exportAsZip (real CSV serialize), wipe + restoreFromBackup (real CSV
 * parse + FK-ordered insert), then read the claim row back and assert its fields.
 *
 * createTestApp() rewrites process.env then dynamic-imports DB-bound modules, so
 * keep this file's imports to the harness + bun:test; import backup/restore
 * dynamically AFTER createTestApp so they bind to the throwaway DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make: 'Toyota', model: 'Camry', year: 2022 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

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
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    // File a fully-populated claim via the real route.
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

    // Real export → real restore (replace) against the same DB. Import the
    // singletons dynamically so they bind to the harness DB.
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.insuranceClaims, 'restore summary counts the claim').toBe(1);

    // The claim row survived with its identity + every field intact.
    const rows = claimRows();
    expect(rows, 'exactly one claim after restore (no dup, no loss)').toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(claimId);
    expect(row.policy_id).toBe(policyId);
    expect(row.vehicle_id).toBe(vehicleId);
    expect(row.claim_type).toBe('collision');
    expect(row.status).toBe('settled');
    expect(row.payout_amount).toBe(1234.56);
    expect(row.fault_designation).toBe('not_at_fault');
    expect(row.description).toBe('Rear-ended at a light');
  });

  test('multiple claims on a policy all survive the round-trip', async () => {
    const vehicleId = await seedVehicle();
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
    expect(claimRows().map((r) => r.claim_type).sort()).toEqual(['collision', 'theft', 'weather']);
  });
});
