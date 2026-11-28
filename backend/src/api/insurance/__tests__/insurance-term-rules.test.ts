import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { repos } from '../../../app-context';
import { CONFIG } from '../../../config';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

const term = (startDate: string, endDate: string, cars = [vehicleId]) => ({
  startDate,
  endDate,
  totalCost: 1200,
  vehicleCoverage: { vehicleIds: cars },
});

async function createPolicy(terms: ReturnType<typeof term>[]) {
  return ctx.authed('POST', '/api/v1/insurance', { company: 'Acme', terms });
}

async function policyId(): Promise<string> {
  const res = await createPolicy([term('2024-01-01', '2024-12-31')]);
  expect(res.status).toBe(201);
  return (await json<DataEnvelope<{ id: string }>>(res)).data.id;
}

const premiumCount = async () =>
  (
    (await ctx.sql.get(
      "SELECT COUNT(*) AS n FROM expenses WHERE source_type = 'insurance_term'"
    )) as { n: number }
  ).n;

describe('insurance term rules', () => {
  test('a term that overlaps another on the same policy and car is refused', async () => {
    const id = await policyId();

    const res = await ctx.authed(
      'POST',
      `/api/v1/insurance/${id}/terms`,
      term('2024-06-01', '2025-05-31')
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('overlaps another term');
    expect(await premiumCount()).toBe(1);
  });

  test('a renewal that starts when the last term ends, or covers another car, is accepted', async () => {
    const id = await policyId();
    const otherCar = await seedVehicle(ctx);

    const renewal = await ctx.authed(
      'POST',
      `/api/v1/insurance/${id}/terms`,
      term('2024-12-31', '2025-12-30')
    );
    const otherCarTerm = await ctx.authed(
      'POST',
      `/api/v1/insurance/${id}/terms`,
      term('2024-03-01', '2025-02-28', [otherCar])
    );

    expect(renewal.status).toBe(201);
    expect(otherCarTerm.status).toBe(201);
  });

  test('overlapping terms in one new policy are refused', async () => {
    const res = await createPolicy([
      term('2024-01-01', '2024-12-31'),
      term('2024-06-01', '2025-05-31'),
    ]);

    expect(res.status).toBe(400);
    expect(await premiumCount()).toBe(0);
  });

  test('an edit that moves a term onto another is refused', async () => {
    const id = await policyId();
    const added = await ctx.authed(
      'POST',
      `/api/v1/insurance/${id}/terms`,
      term('2025-01-01', '2025-12-31')
    );
    const policy = (await json<DataEnvelope<{ terms: { id: string; startDate: string }[] }>>(added))
      .data;
    const later = policy.terms.find((t) => t.startDate.startsWith('2025'));

    const res = await ctx.authed('PUT', `/api/v1/insurance/${id}/terms/${later?.id}`, {
      startDate: '2024-10-01',
    });

    expect(res.status).toBe(400);
  });

  test('a term longer than the configured maximum is refused', async () => {
    const res = await createPolicy([term('2020-01-01', '2029-12-31')]);

    expect(res.status).toBe(400);
    expect(await res.text()).toContain(`${CONFIG.validation.insurance.maxTermMonths} months`);
  });

  test('a policy cannot grow past the configured number of terms', async () => {
    const id = await policyId();
    const max = CONFIG.validation.insurance.maxTerms;
    for (let i = 1; i < max; i++) {
      const year = 2024 + i;
      await ctx.sql.run(
        'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
        [`t-${i}`, id, Date.UTC(year, 0, 1) / 1000, Date.UTC(year, 11, 31) / 1000]
      );
    }

    const res = await ctx.authed(
      'POST',
      `/api/v1/insurance/${id}/terms`,
      term('2100-01-01', '2100-12-31')
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain(`${max} terms`);
  });
});

describe('deleting a policy', () => {
  test('keeps its premium expenses when the policy delete fails', async () => {
    const id = await policyId();
    const spy = spyOn(repos().insurancePolicies, 'delete').mockImplementation(() => {
      throw new Error('disk I/O error');
    });
    try {
      const res = await ctx.authed('DELETE', `/api/v1/insurance/${id}`);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await premiumCount()).toBe(1);
  });
});
