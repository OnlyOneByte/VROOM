import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'ins-car';
const PRIVATE = 'ins-private-car';

interface PolicyView {
  vehicleIds: string[];
  terms: { totalCost?: number | null }[];
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  await seedCar(ctx, PRIVATE);
  m = await seedMembers(ctx, CAR, 'ins');
  ctx.sqlite.run(
    "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount) VALUES ('loan-1', ?, 'Bank', 1000000, 60, 1704067200, 20000)",
    [CAR]
  );
  ctx.sqlite.run(
    "INSERT INTO insurance_policies (id, user_id, company) VALUES ('pol-1', ?, 'Mutual')",
    [ctx.user.id]
  );
  ctx.sqlite.run(
    "INSERT INTO insurance_terms (id, policy_id, start_date, end_date, total_cost) VALUES ('term-1', 'pol-1', 1704067200, 1735689600, 120000)"
  );
  for (const vehicleId of [CAR, PRIVATE]) {
    ctx.sqlite.run('INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES (?, ?)', [
      'term-1',
      vehicleId,
    ]);
  }
  ctx.sqlite.run(
    "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('pol-doc', ?, 'insurance_policy', 'pol-1', 'p.pdf', 'application/pdf', 10)",
    [ctx.user.id]
  );
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const status = (request: RequestFn, method: string, path: string, body?: unknown) =>
  request(method, path, body).then((res) => res.status);

async function policies(request: RequestFn): Promise<PolicyView[]> {
  const res = await request('GET', `/api/v1/insurance/vehicles/${CAR}/policies`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<PolicyView[]>>(res)).data;
}

describe('financing resolves through can() for every role', () => {
  const loan = `/api/v1/financing/vehicles/${CAR}/financing`;
  const amount = '/api/v1/financing/loan-1/payment-amount';

  test('reads: the owner and co-owner see the loan; editors and viewers only with an override', async () => {
    expect(await status(ctx.authed, 'GET', loan)).toBe(200);
    expect(await status(m.coOwner.request, 'GET', loan)).toBe(200);
    expect(await status(m.editor.request, 'GET', loan)).toBe(403);
    expect(await status(m.viewer.request, 'GET', loan)).toBe(403);
    expect(await status(m.stranger.request, 'GET', loan)).toBe(404);
    expect(await status(m.disabled.request, 'GET', loan)).toBe(403);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.financing.read', 'allow');
    expect(await status(m.viewer.request, 'GET', loan)).toBe(200);
  });

  test('writes: a co-owner changes the loan; an editor needs an allow override; a deny wins', async () => {
    expect(await status(m.coOwner.request, 'PATCH', amount, { paymentAmount: 210 })).toBe(200);
    expect(await status(m.editor.request, 'PATCH', amount, { paymentAmount: 220 })).toBe(403);
    await overrideOn(ctx, CAR, m.editor, 'vehicle.financing.write', 'allow');
    expect(await status(m.editor.request, 'PATCH', amount, { paymentAmount: 220 })).toBe(200);
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.financing.read', 'deny');
    expect(await status(m.coOwner.request, 'PUT', '/api/v1/financing/loan-1/payoff')).toBe(403);
    expect(await status(m.stranger.request, 'DELETE', '/api/v1/financing/loan-1')).toBe(404);
  });

  test('the vehicle tells a sharee whether loan details are visible to them', async () => {
    const view = async (request: RequestFn) =>
      (
        await json<
          DataEnvelope<{ financing?: unknown; sharedAccess?: { seesFinancials: boolean } }>
        >(await request('GET', `/api/v1/vehicles/${CAR}`))
      ).data;
    expect((await view(m.coOwner.request)).sharedAccess?.seesFinancials).toBe(true);
    expect((await view(m.coOwner.request)).financing).toBeTruthy();
    const viewer = await view(m.viewer.request);
    expect(viewer.sharedAccess?.seesFinancials).toBe(false);
    expect(viewer.financing).toBeUndefined();
  });
});

describe('insurance resolves through can() for every role', () => {
  test('policy views show members their car only, with premiums only for insurance readers', async () => {
    expect((await policies(ctx.authed))[0]?.vehicleIds.sort()).toEqual([PRIVATE, CAR].sort());
    const coOwners = (await policies(m.coOwner.request))[0];
    expect(coOwners?.vehicleIds).toEqual([CAR]);
    expect(coOwners?.terms[0]?.totalCost).toBeTruthy();
    const viewers = (await policies(m.viewer.request))[0];
    expect(viewers?.vehicleIds).toEqual([CAR]);
    expect(viewers?.terms[0]?.totalCost).toBeUndefined();
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.insurance.read', 'allow');
    expect((await policies(m.viewer.request))[0]?.terms[0]?.totalCost).toBeTruthy();
    expect(
      await status(m.stranger.request, 'GET', `/api/v1/insurance/vehicles/${CAR}/policies`)
    ).toBe(404);
  });

  test('policy documents need insurance read on every covered car and stay with the owner for writes', async () => {
    ctx.sqlite.run(
      "INSERT INTO insurance_policies (id, user_id, company) VALUES ('pol-2', ?, 'Mutual')",
      [ctx.user.id]
    );
    ctx.sqlite.run(
      "INSERT INTO insurance_terms (id, policy_id, start_date, end_date, total_cost) VALUES ('term-2', 'pol-2', 1704067200, 1735689600, 90000)"
    );
    ctx.sqlite.run(
      "INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES ('term-2', ?)",
      [CAR]
    );
    ctx.sqlite.run(
      "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('pol2-doc', ?, 'insurance_policy', 'pol-2', 'p.pdf', 'application/pdf', 10)",
      [ctx.user.id]
    );
    const shared = '/api/v1/photos/insurance_policy/pol-2';
    const multiCar = '/api/v1/photos/insurance_policy/pol-1';
    expect(await status(ctx.authed, 'GET', multiCar)).toBe(200);
    expect(await status(m.coOwner.request, 'GET', multiCar)).toBe(404);
    expect(await status(m.coOwner.request, 'GET', shared)).toBe(200);
    expect(await status(m.editor.request, 'GET', shared)).toBe(403);
    expect(await status(m.viewer.request, 'GET', shared)).toBe(403);
    expect(await status(m.disabled.request, 'GET', shared)).toBe(403);
    expect(await status(m.stranger.request, 'GET', shared)).toBe(404);
    await overrideOn(ctx, CAR, m.viewer, 'vehicle.insurance.read', 'allow');
    expect(await status(m.viewer.request, 'GET', shared)).toBe(200);
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.insurance.read', 'deny');
    expect(await status(m.coOwner.request, 'GET', shared)).toBe(403);
    await overrideOn(ctx, CAR, m.editor, 'vehicle.insurance.write', 'allow');
    expect(await status(m.editor.request, 'DELETE', `${shared}/pol2-doc`)).toBe(404);
    expect(await status(m.coOwner.request, 'DELETE', `${multiCar}/pol-doc`)).toBe(404);
    expect(await status(ctx.authed, 'DELETE', `${shared}/pol2-doc`)).toBe(204);
  });

  test("claims and claim documents follow insurance read on the claim's own car", async () => {
    for (const [id, vehicleId] of [
      ['claim-shared', CAR],
      ['claim-private', PRIVATE],
    ]) {
      ctx.sqlite.run(
        "INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type, vehicle_id) VALUES (?, 'pol-1', 1704067200, 'collision', ?)",
        [id, vehicleId]
      );
    }
    const claims = '/api/v1/insurance/pol-1/claims';
    const claimIds = async (request: RequestFn) => {
      const res = await request('GET', claims);
      expect(res.status).toBe(200);
      return (await json<DataEnvelope<{ id: string }[]>>(res)).data.map((cl) => cl.id).sort();
    };
    expect(await claimIds(ctx.authed)).toEqual(['claim-private', 'claim-shared']);
    expect(await claimIds(m.coOwner.request)).toEqual(['claim-shared']);
    expect(await claimIds(m.editor.request)).toEqual([]);
    expect(await claimIds(m.viewer.request)).toEqual([]);
    expect(await status(m.stranger.request, 'GET', claims)).toBe(404);
    expect(await status(m.disabled.request, 'GET', claims)).toBe(403);

    const docs = (claimId: string) => `/api/v1/photos/insurance_claim/${claimId}`;
    expect(await status(m.coOwner.request, 'GET', docs('claim-shared'))).toBe(200);
    expect(await status(m.coOwner.request, 'GET', docs('claim-private'))).toBe(404);
    expect(await status(m.viewer.request, 'GET', docs('claim-shared'))).toBe(403);
    expect(await status(ctx.authed, 'GET', docs('claim-private'))).toBe(200);

    await overrideOn(ctx, CAR, m.viewer, 'vehicle.insurance.read', 'allow');
    expect(await claimIds(m.viewer.request)).toEqual(['claim-shared']);
    expect(await status(m.viewer.request, 'GET', docs('claim-shared'))).toBe(200);
    await overrideOn(ctx, CAR, m.coOwner, 'vehicle.insurance.read', 'deny');
    expect(await claimIds(m.coOwner.request)).toEqual([]);
    expect(await status(m.coOwner.request, 'GET', docs('claim-shared'))).toBe(403);
  });

  test('policy writes stay with the policy owner', async () => {
    expect(
      await status(m.coOwner.request, 'PUT', '/api/v1/insurance/pol-1', { company: 'X' })
    ).toBe(404);
    expect(await status(ctx.authed, 'PUT', '/api/v1/insurance/pol-1', { company: 'X' })).toBe(200);
  });
});
