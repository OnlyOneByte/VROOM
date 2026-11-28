import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let covered: string;
let other: string;
let policyId: string;
let termA: string;
let termB: string;

beforeEach(async () => {
  ctx = await createTestApp();
  covered = await seedVehicle(ctx);
  other = await seedVehicle(ctx);
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme',
    terms: [
      {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        vehicleCoverage: { vehicleIds: [covered] },
      },
      { startDate: '2024-01-01', endDate: '2024-12-31', vehicleCoverage: { vehicleIds: [other] } },
    ],
  });
  expect(res.status).toBe(201);
  const policy = (
    await json<
      DataEnvelope<{ id: string; termVehicleCoverage: { termId: string; vehicleId: string }[] }>
    >(res)
  ).data;
  policyId = policy.id;
  termA = policy.termVehicleCoverage.find((tc) => tc.vehicleId === covered)?.termId ?? '';
  termB = policy.termVehicleCoverage.find((tc) => tc.vehicleId === other)?.termId ?? '';
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const file = (body: Record<string, unknown>) =>
  ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
    claimDate: '2024-05-01',
    claimType: 'collision',
    ...body,
  });

describe('claim car and term', () => {
  test('a car the policy does not cover is refused', async () => {
    const stranger = await seedVehicle(ctx);

    const res = await file({ vehicleId: stranger });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('does not cover this vehicle');
  });

  test('a term that does not cover the car is refused', async () => {
    const res = await file({ vehicleId: covered, termId: termB });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('term does not cover this vehicle');
  });

  test('a covered car, with or without its term, is accepted', async () => {
    expect((await file({ vehicleId: covered })).status).toBe(201);
    expect((await file({ vehicleId: covered, termId: termA })).status).toBe(201);
  });

  test('an edit that moves the claim to a term not covering its car is refused', async () => {
    const created = await file({ vehicleId: covered, termId: termA });
    const claimId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      termId: termB,
    });

    expect(res.status).toBe(400);
  });

  test('a claim whose car is no longer covered still saves when the car is unchanged', async () => {
    const created = await file({ vehicleId: other, termId: termB });
    const claimId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;
    await ctx.sql.run('DELETE FROM insurance_term_vehicles WHERE term_id = ?', [termB]);
    await ctx.sql.run('INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES (?, ?)', [
      termB,
      covered,
    ]);

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      status: 'settled',
      vehicleId: other,
      termId: termB,
    });

    expect(res.status).toBe(200);
  });

  test('clearing the car, or giving only a term, is accepted', async () => {
    const created = await file({ vehicleId: covered });
    const claimId = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const cleared = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      vehicleId: null,
    });
    const termOnly = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/claims/${claimId}`, {
      termId: termB,
    });

    expect(cleared.status).toBe(200);
    expect(termOnly.status).toBe(200);
  });
});
