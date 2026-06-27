/**
 * vehicle-sharing T8b — per-vehicle insurance READ widening through the REAL stack.
 *
 * GET /insurance/vehicles/:vehicleId/policies flips validateVehicleOwnership → requireVehicleRead
 * (owner | accepted viewer/editor | 404). The wrinkle the expense/odometer/analytics reads did NOT
 * have: findByVehicleId returns the WHOLE policy — all terms, the full termVehicleCoverage junction,
 * and vehicleIds deduped across ALL terms — because a policy can span several of the owner's vehicles.
 * For a NON-owner that would leak the owner's OTHER vehicles. So the route applies the design §6.4
 * blast-radius rule (narrowPolicyToVehicle): a shared invitee sees ONLY the shared vehicle's terms +
 * coverage + id; the OWNER sees the full policy unchanged.
 *
 * Fixture: A is the OWNER (the harness-seeded session); B is a SECOND user invited as viewer/editor.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp; // owner (user A)
let bCookie: string; // invitee B
let bEmail: string;
let bCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  const { lucia } = await import('../../auth/lucia');
  const bId = `ins-invitee-${++bCounter}`;
  bEmail = `ins-invitee-${bCounter}@test.com`;
  await db.insert(schema.users).values({ id: bId, email: bEmail, displayName: 'Ins B' });
  const session = await lucia.createSession(bId, {});
  const sc = lucia.createSessionCookie(session.id);
  bCookie = `${sc.name}=${sc.value}`;
});
afterEach(() => ctx.close());

interface PolicyRow {
  id: string;
  terms: Array<{ id: string }>;
  termVehicleCoverage: Array<{ termId: string; vehicleId: string }>;
  vehicleIds: string[];
}

async function asB(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: bCookie, 'Sec-Fetch-Site': 'same-origin' };
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init = { ...init, body: JSON.stringify(body) };
  }
  return ctx.app.request(path, init);
}

async function acceptShare(vehicleId: string, level: 'viewer' | 'editor'): Promise<void> {
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteId = (await json<DataEnvelope<{ id: string }>>(invite)).data.id;
  expect((await asB('POST', `/api/v1/shares/${inviteId}/accept`)).status).toBe(200);
}

describe('insurance per-vehicle READ widening + blast-radius (T8b)', () => {
  test('a multi-vehicle policy is NARROWED to the shared vehicle for a viewer (no leak of the other vehicle)', async () => {
    // A owns two vehicles; one policy term covers BOTH. A shares only vehicleA with B.
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
    await acceptShare(vehicleA, 'viewer');

    const res = await asB('GET', `/api/v1/insurance/vehicles/${vehicleA}/policies`);
    const body = await json<DataEnvelope<PolicyRow[]>>(res);
    expect(res.status).toBe(200);
    expect(body.data.length).toBe(1);
    const policy = body.data[0]!;
    // Blast-radius: the invitee sees ONLY vehicleA — never vehicleB (the owner's other vehicle).
    expect(policy.vehicleIds).toEqual([vehicleA]);
    expect(policy.termVehicleCoverage.every((c) => c.vehicleId === vehicleA)).toBe(true);
    expect(policy.termVehicleCoverage.some((c) => c.vehicleId === vehicleB)).toBe(false);
    // The shared term is still present (it covers vehicleA).
    expect(policy.terms.length).toBe(1);
  });

  test('the OWNER reading the same vehicle sees the FULL policy (both vehicles, unchanged)', async () => {
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
    // Owner is not narrowed — both vehicles present.
    expect(body.data[0]!.vehicleIds.sort()).toEqual([vehicleA, vehicleB].sort());
  });

  test('a term that covers ONLY the owner other vehicle is dropped from the invitee view', async () => {
    // Two terms: term1 covers vehicleA (shared), term2 covers ONLY vehicleB (not shared).
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
    await acceptShare(vehicleA, 'editor');

    const body = await json<DataEnvelope<PolicyRow[]>>(
      await asB('GET', `/api/v1/insurance/vehicles/${vehicleA}/policies`)
    );
    expect(body.data.length).toBe(1);
    const policy = body.data[0]!;
    // Only the vehicleA-covering term survives; the vehicleB-only term is dropped (no leak).
    expect(policy.terms.length).toBe(1);
    expect(policy.vehicleIds).toEqual([vehicleA]);
    expect(policy.termVehicleCoverage.every((c) => c.vehicleId === vehicleA)).toBe(true);
  });

  test('a STRANGER (no share) is denied the per-vehicle policies list (existence-hiding 404)', async () => {
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
    expect((await asB('GET', `/api/v1/insurance/vehicles/${vehicleId}/policies`)).status).toBe(404);
  });

  test('a PENDING (un-accepted) invite grants no insurance read (still 404)', async () => {
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
    await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level: 'viewer' });
    expect((await asB('GET', `/api/v1/insurance/vehicles/${vehicleId}/policies`)).status).toBe(404);
  });
});
