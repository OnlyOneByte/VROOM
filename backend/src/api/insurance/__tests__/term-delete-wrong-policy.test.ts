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

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

interface PolicyBody {
  id: string;
  terms: Array<{ id: string }>;
}

async function policy(vehicleId: string, company: string): Promise<PolicyBody> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company,
    terms: [
      {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        totalCost: 1200,
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const body = await json<DataEnvelope<PolicyBody>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data;
}

async function premiums(termId: string): Promise<number> {
  const row = (await ctx.sql.get(
    `SELECT COUNT(*) AS n FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?`,
    [termId]
  )) as { n: number };
  return row.n;
}

describe('deleting an insurance term', () => {
  test('a term asked for under the wrong policy keeps its premium', async () => {
    const vehicleId = await seedVehicle(ctx);
    const first = await policy(vehicleId, 'First Mutual');
    const second = await policy(vehicleId, 'Second Mutual');
    const otherTerm = second.terms[0].id;
    expect(await premiums(otherTerm)).toBe(1);

    const res = await ctx.authed('DELETE', `/api/v1/insurance/${first.id}/terms/${otherTerm}`);

    expect(res.status).toBe(404);
    expect(await premiums(otherTerm)).toBe(1);
  });

  test('a term deleted under its own policy takes its premium with it', async () => {
    const vehicleId = await seedVehicle(ctx);
    const own = await policy(vehicleId, 'Own Mutual');
    const termId = own.terms[0].id;

    const res = await ctx.authed('DELETE', `/api/v1/insurance/${own.id}/terms/${termId}`);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await premiums(termId)).toBe(0);
  });
});
