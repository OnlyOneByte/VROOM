/**
 * Shared-vehicle reads of insurance. A policy can span several of the owner's vehicles, so a shared viewer
 * must see only the shared vehicle's terms, coverage, and ids. Claims are filtered the same way. The owner
 * sees everything.
 * User A owns the vehicles. User B is invited as viewer or editor.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // owner (user A)
let b: Invitee; // invitee B

beforeEach(async () => {
  ctx = await createTestApp();
  b = await createInvitee(ctx, 'ins-invitee');
});
afterEach(() => ctx.close());

interface PolicyRow {
  id: string;
  terms: Array<{ id: string }>;
  termVehicleCoverage: Array<{ termId: string; vehicleId: string }>;
  vehicleIds: string[];
}

describe('insurance per-vehicle reads for shared vehicles', () => {
  test('a multi-vehicle policy is narrowed to the shared vehicle for a viewer', async () => {
    const vehicleA = await seedVehicle(ctx, { make: 'Shared', model: 'CarA', year: 2021 });
    const vehicleB = await seedVehicle(ctx, { make: 'Private', model: 'CarB', year: 2022 });
    const policyRes = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Multi Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleA, vehicleB] },
        },
      ],
    });
    expect(policyRes.status).toBe(201);
    await b.acceptShare(vehicleA, 'viewer');

    const res = await b.request('GET', `/api/v1/insurance/vehicles/${vehicleA}/policies`);
    const body = await json<DataEnvelope<PolicyRow[]>>(res);
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
    const policy = body.data[0];
    expect(policy.vehicleIds).toEqual([vehicleA]);
    expect(policy.termVehicleCoverage.every((c) => c.vehicleId === vehicleA)).toBe(true);
    expect(policy.termVehicleCoverage.some((c) => c.vehicleId === vehicleB)).toBe(false);
    expect(policy.terms.length).toBe(1);
  });

  test('the owner reading the same vehicle sees the full policy', async () => {
    const vehicleA = await seedVehicle(ctx, { make: 'OwnA', model: 'CarA', year: 2021 });
    const vehicleB = await seedVehicle(ctx, { make: 'OwnB', model: 'CarB', year: 2022 });
    await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Owner Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleA, vehicleB] },
        },
      ],
    });
    const body = await json<DataEnvelope<PolicyRow[]>>(
      await ctx.authed('GET', `/api/v1/insurance/vehicles/${vehicleA}/policies`)
    );
    expect(body.data.length).toBe(1);
    expect(body.data[0].vehicleIds.sort()).toEqual([vehicleA, vehicleB].sort());
  });

  test('a term covering only the owner other vehicle is dropped from the viewer view', async () => {
    const vehicleA = await seedVehicle(ctx, { make: 'Shared', model: 'CarA', year: 2021 });
    const vehicleB = await seedVehicle(ctx, { make: 'Private', model: 'CarB', year: 2022 });
    await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Two Term Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleA] },
        },
        {
          startDate: '2023-01-01T00:00:00.000Z',
          endDate: '2024-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleB] },
        },
      ],
    });
    await b.acceptShare(vehicleA, 'editor');

    const body = await json<DataEnvelope<PolicyRow[]>>(
      await b.request('GET', `/api/v1/insurance/vehicles/${vehicleA}/policies`)
    );
    expect(body.data.length).toBe(1);
    const policy = body.data[0];
    expect(policy.terms.length).toBe(1);
    expect(policy.vehicleIds).toEqual([vehicleA]);
    expect(policy.termVehicleCoverage.every((c) => c.vehicleId === vehicleA)).toBe(true);
  });

  test('a stranger with no share gets a 404 on the per-vehicle policies list', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'NoShare', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Private Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleId] },
        },
      ],
    });
    expect(
      (await b.request('GET', `/api/v1/insurance/vehicles/${vehicleId}/policies`)).status
    ).toBe(404);
  });

  test('a pending invite grants no insurance read', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Pending', model: 'Car', year: 2021 });
    await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Pending Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [vehicleId] },
        },
      ],
    });
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: b.email, level: 'viewer' });
    expect(
      (await b.request('GET', `/api/v1/insurance/vehicles/${vehicleId}/policies`)).status
    ).toBe(404);
  });
});

interface ClaimRow {
  id: string;
  vehicleId: string | null;
}

/** Creates a policy whose term covers both vehicles, and returns the policy id. */
async function createTwoVehiclePolicy(vehicleA: string, vehicleB: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Claims Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        vehicleCoverage: { vehicleIds: [vehicleA, vehicleB] },
      },
    ],
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

/** Files a claim as the owner, optionally attributed to a vehicle. */
async function fileClaim(policyId: string, claimType: string, vehicleId?: string): Promise<string> {
  const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
    claimDate: '2024-06-01T00:00:00.000Z',
    claimType,
    ...(vehicleId ? { vehicleId } : {}),
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

describe('insurance claim reads for shared vehicles', () => {
  test('a viewer sees only claims attributed to the shared vehicle', async () => {
    const vehicleA = await seedVehicle(ctx, { make: 'Shared', model: 'CarA', year: 2021 });
    const vehicleB = await seedVehicle(ctx, { make: 'Private', model: 'CarB', year: 2022 });
    const policyId = await createTwoVehiclePolicy(vehicleA, vehicleB);
    const claimA = await fileClaim(policyId, 'collision', vehicleA);
    await fileClaim(policyId, 'theft', vehicleB);
    await fileClaim(policyId, 'weather');
    await b.acceptShare(vehicleA, 'viewer');

    const res = await b.request('GET', `/api/v1/insurance/${policyId}/claims`);
    const body = await json<DataEnvelope<ClaimRow[]>>(res);
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(claimA);
    expect(body.data[0].vehicleId).toBe(vehicleA);
  });

  test('the owner reading the same policy sees all claims', async () => {
    const vehicleA = await seedVehicle(ctx, { make: 'OwnA', model: 'CarA', year: 2021 });
    const vehicleB = await seedVehicle(ctx, { make: 'OwnB', model: 'CarB', year: 2022 });
    const policyId = await createTwoVehiclePolicy(vehicleA, vehicleB);
    await fileClaim(policyId, 'collision', vehicleA);
    await fileClaim(policyId, 'theft', vehicleB);
    await fileClaim(policyId, 'weather');

    const body = await json<DataEnvelope<ClaimRow[]>>(
      await ctx.authed('GET', `/api/v1/insurance/${policyId}/claims`)
    );
    expect(body.data.length).toBe(3);
  });

  test('an editor can also read the shared vehicle claims', async () => {
    const vehicleA = await seedVehicle(ctx, { make: 'Shared', model: 'CarA', year: 2021 });
    const vehicleB = await seedVehicle(ctx, { make: 'Private', model: 'CarB', year: 2022 });
    const policyId = await createTwoVehiclePolicy(vehicleA, vehicleB);
    const claimA = await fileClaim(policyId, 'collision', vehicleA);
    await fileClaim(policyId, 'theft', vehicleB);
    await b.acceptShare(vehicleA, 'editor');

    const body = await json<DataEnvelope<ClaimRow[]>>(
      await b.request('GET', `/api/v1/insurance/${policyId}/claims`)
    );
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe(claimA);
  });

  test('a stranger with no share to any covered vehicle gets a 404 on the claims list', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'NoShare', model: 'Car', year: 2021 });
    const policyId = await createTwoVehiclePolicy(
      vehicleId,
      await seedVehicle(ctx, { make: 'NoShare2', model: 'Car', year: 2022 })
    );
    await fileClaim(policyId, 'collision', vehicleId);
    expect((await b.request('GET', `/api/v1/insurance/${policyId}/claims`)).status).toBe(404);
  });

  test('a pending invite grants no claims read', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Pending', model: 'Car', year: 2021 });
    const policyId = await createTwoVehiclePolicy(
      vehicleId,
      await seedVehicle(ctx, { make: 'Pending2', model: 'Car', year: 2022 })
    );
    await fileClaim(policyId, 'collision', vehicleId);
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: b.email, level: 'viewer' });
    expect((await b.request('GET', `/api/v1/insurance/${policyId}/claims`)).status).toBe(404);
  });
});
