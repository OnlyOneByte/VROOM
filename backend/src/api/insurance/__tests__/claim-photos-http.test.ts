/**
 * Photo ownership for insurance claims. GET /photos/insurance_claim/:claimId runs the same ownership gate
 * an upload would, so it is enough to test the gate without a storage provider.
 */

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

async function seedClaim(policyId: string): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
    claimDate: '2024-06-15T00:00:00.000Z',
    claimType: 'collision',
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('insurance_claim photos', () => {
  test('GET photos for an owned claim returns an empty list', async () => {
    const vehicleId = await seedVehicle(ctx);
    const policyId = await seedPolicy(vehicleId);
    const claimId = await seedClaim(policyId);

    const res = await ctx.authed('GET', `/api/v1/photos/insurance_claim/${claimId}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json<DataEnvelope<unknown[]>>(res);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  test('GET photos for a non-existent claim is rejected (404)', async () => {
    const res = await ctx.authed('GET', '/api/v1/photos/insurance_claim/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('anonymous access is unauthorized', async () => {
    const res = await ctx.anon('GET', '/api/v1/photos/insurance_claim/any-id');
    expect(res.status).toBe(401);
  });
});
