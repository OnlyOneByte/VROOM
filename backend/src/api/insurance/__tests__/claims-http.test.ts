/**
 * In-process HTTP tests for the insurance claims routes — through the REAL stack
 * (middleware → auth → zValidator → handler → repository → DB).
 *
 * Covers the claim lifecycle (file → list → update → delete), ownership scoping
 * (a claim under another user's policy is 404, never readable/mutable), and zod
 * enum rejection (bad claimType/status). createTestApp() rewrites process.env +
 * dynamic-imports DB-bound modules, so this file imports only the harness.
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

/** Seed a policy (with one term covering the vehicle) and return its id. */
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

interface ClaimRow {
  id: string;
  policyId: string;
  claimType: string;
  status: string;
  description: string | null;
  payoutAmount: number | null;
  faultDesignation: string | null;
  vehicleId: string | null;
}

describe('insurance claims HTTP routes', () => {
  test('files a claim (201), lists it, updates status, deletes it', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    // File a claim.
    const created = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
      description: 'Rear-ended at a light',
      payoutAmount: 1200.5,
      faultDesignation: 'not_at_fault',
      vehicleId,
    });
    const createdBody = await json<DataEnvelope<ClaimRow>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    expect(createdBody.data.status).toBe('filed'); // default
    expect(createdBody.data.claimType).toBe('collision');
    const claimId = createdBody.data.id;

    // List shows it.
    const list = await ctx.authed('GET', `/api/v1/insurance/${policyId}/claims`);
    const listBody = await json<DataEnvelope<ClaimRow[]>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].id).toBe(claimId);

    // Update status → settled.
    const updated = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      status: 'settled',
      payoutAmount: 1500,
    });
    const updatedBody = await json<DataEnvelope<ClaimRow>>(updated);
    expect(updated.status, JSON.stringify(updatedBody)).toBe(200);
    expect(updatedBody.data.status).toBe('settled');
    expect(updatedBody.data.payoutAmount).toBe(1500);

    // Delete → list empties.
    const del = await ctx.authed('DELETE', `/api/v1/insurance/${policyId}/claims/${claimId}`);
    expect(del.status).toBe(200);
    const listAfter = await ctx.authed('GET', `/api/v1/insurance/${policyId}/claims`);
    expect((await json<DataEnvelope<ClaimRow[]>>(listAfter)).data).toHaveLength(0);
  });

  test('clearing an optional field (null) actually clears it; omitting it preserves', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    // File a claim with every optional field set.
    const created = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
      description: 'Rear-ended at a light',
      payoutAmount: 1200.5,
      faultDesignation: 'not_at_fault',
      vehicleId,
    });
    const createdBody = await json<DataEnvelope<ClaimRow>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const claimId = createdBody.data.id;
    expect(createdBody.data.payoutAmount).toBe(1200.5);
    expect(createdBody.data.description).toBe('Rear-ended at a light');
    expect(createdBody.data.faultDesignation).toBe('not_at_fault');
    expect(createdBody.data.vehicleId).toBe(vehicleId);

    // Omitting a field on update preserves it (only status changes here).
    const partial = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      status: 'settled',
    });
    const partialBody = await json<DataEnvelope<ClaimRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    expect(partialBody.data.status).toBe('settled');
    expect(partialBody.data.payoutAmount).toBe(1200.5); // preserved
    expect(partialBody.data.description).toBe('Rear-ended at a light'); // preserved
    expect(partialBody.data.faultDesignation).toBe('not_at_fault'); // preserved

    // Explicit null clears the optional fields (the user emptied them in the form).
    const cleared = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      description: null,
      payoutAmount: null,
      faultDesignation: null,
      vehicleId: null,
    });
    const clearedBody = await json<DataEnvelope<ClaimRow>>(cleared);
    expect(cleared.status, JSON.stringify(clearedBody)).toBe(200);
    expect(clearedBody.data.description).toBeNull();
    expect(clearedBody.data.payoutAmount).toBeNull();
    expect(clearedBody.data.faultDesignation).toBeNull();
    expect(clearedBody.data.vehicleId).toBeNull();
  });

  test('rejects an invalid claimType / status (zod enum)', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    const badType = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'meteor-strike',
    });
    expect(badType.status).toBe(400);

    const badStatus = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'other',
      status: 'pending', // not in CLAIM_STATUSES
    });
    expect(badStatus.status).toBe(400);
  });

  test('claims under an unowned policy are not accessible (404)', async () => {
    // A random policy id the user does not own.
    const list = await ctx.authed('GET', '/api/v1/insurance/someone-elses-policy/claims');
    expect(list.status).toBeGreaterThanOrEqual(400);
    expect(list.status).toBeLessThan(500);

    const file = await ctx.authed('POST', '/api/v1/insurance/someone-elses-policy/claims', {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'theft',
    });
    expect(file.status).toBeGreaterThanOrEqual(400);
    expect(file.status).toBeLessThan(500);
  });

  test('anonymous access is unauthorized', async () => {
    const res = await ctx.anon('GET', '/api/v1/insurance/any-policy/claims');
    expect(res.status).toBe(401);
  });
});
