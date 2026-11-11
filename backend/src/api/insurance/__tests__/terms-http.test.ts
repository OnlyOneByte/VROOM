/**
 * HTTP tests for the insurance term and policy update routes. An optional field sent as null clears the
 * column, and an omitted field keeps its value. Vehicle links must be owned by the caller, and a term
 * update replaces its premium expense.
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

interface TermRow {
  id: string;
  deductibleAmount: number | null;
  coverageLimit: number | null;
  agentName: string | null;
  agentPhone: string | null;
  policyNumber: string | null;
}

interface PolicyRow {
  id: string;
  notes: string | null;
  terms: TermRow[];
}

/** Seed a policy with one fully-populated term; return policy + term ids. */
async function seedPolicyWithTerm(
  vehicleId: string
): Promise<{ policyId: string; termId: string }> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        policyNumber: 'POL-123',
        deductibleAmount: 500,
        coverageLimit: 100000,
        agentName: 'Pat Agent',
        agentPhone: '555-0100',
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const body = await json<DataEnvelope<PolicyRow>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { policyId: body.data.id, termId: body.data.terms[0].id };
}

describe('insurance term update clears optional fields', () => {
  test('explicit null clears a term field; omitting it preserves the prior value', async () => {
    const vehicleId = await seedVehicle(ctx);
    const { policyId, termId } = await seedPolicyWithTerm(vehicleId);

    const partial = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      policyNumber: 'POL-456',
    });
    const partialBody = await json<DataEnvelope<PolicyRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    const afterPartial = partialBody.data.terms.find((t) => t.id === termId);
    expect(afterPartial?.policyNumber).toBe('POL-456');
    expect(afterPartial?.deductibleAmount).toBe(500); // preserved
    expect(afterPartial?.agentName).toBe('Pat Agent'); // preserved

    const cleared = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      deductibleAmount: null,
      coverageLimit: null,
      agentName: null,
      agentPhone: null,
      policyNumber: null,
    });
    const clearedBody = await json<DataEnvelope<PolicyRow>>(cleared);
    expect(cleared.status, JSON.stringify(clearedBody)).toBe(200);
    const afterClear = clearedBody.data.terms.find((t) => t.id === termId);
    expect(afterClear?.deductibleAmount).toBeNull();
    expect(afterClear?.coverageLimit).toBeNull();
    expect(afterClear?.agentName).toBeNull();
    expect(afterClear?.agentPhone).toBeNull();
    expect(afterClear?.policyNumber).toBeNull();
  });

  test('policy notes: explicit null clears it; omitting it preserves', async () => {
    const vehicleId = await seedVehicle(ctx);
    const { policyId } = await seedPolicyWithTerm(vehicleId);

    const set = await ctx.authed('PUT', `/api/v1/insurance/${policyId}`, {
      notes: 'Bundled with home insurance',
    });
    const setBody = await json<DataEnvelope<PolicyRow>>(set);
    expect(set.status, JSON.stringify(setBody)).toBe(200);
    expect(setBody.data.notes).toBe('Bundled with home insurance');

    const partial = await ctx.authed('PUT', `/api/v1/insurance/${policyId}`, {
      company: 'Renamed Mutual',
    });
    const partialBody = await json<DataEnvelope<PolicyRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    expect(partialBody.data.notes).toBe('Bundled with home insurance');

    const cleared = await ctx.authed('PUT', `/api/v1/insurance/${policyId}`, {
      notes: null,
    });
    const clearedBody = await json<DataEnvelope<PolicyRow>>(cleared);
    expect(cleared.status, JSON.stringify(clearedBody)).toBe(200);
    expect(clearedBody.data.notes).toBeNull();
  });
});

/**
 * Term writes reject vehicle ids the caller does not own, so a term cannot plant a cross-tenant reference.
 * The foreign vehicle is raw-seeded so it coexists with the harness user in the shared database.
 */
describe('insurance term writes reject a foreign vehicleId', () => {
  /** Seeds a vehicle owned by another user. */
  function seedForeignVehicle(id: string): void {
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('u-foreign-84', 'f84@test.com', 'Foreign 84')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, 'u-foreign-84', 'Mazda', '3', 2020)`,
      [id]
    );
  }

  /** Counts junction rows for a vehicle, to prove nothing was written. */
  function junctionCountFor(vehicleId: string): number {
    const rows = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM insurance_term_vehicles WHERE vehicle_id = ?')
      .all(vehicleId) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  test('POST /insurance with a foreign vehicleId → 404, no junction row planted', async () => {
    seedForeignVehicle('veh-foreign-create');
    const res = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Acme Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: ['veh-foreign-create'] },
        },
      ],
    });
    expect(res.status).toBe(404);
    expect(junctionCountFor('veh-foreign-create')).toBe(0);
  });

  test('POST /insurance/:id/terms with a foreign vehicleId → 404, no junction row planted', async () => {
    const ownVehicle = await seedVehicle(ctx);
    const { policyId } = await seedPolicyWithTerm(ownVehicle);
    seedForeignVehicle('veh-foreign-addterm');

    const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/terms`, {
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
      vehicleCoverage: { vehicleIds: ['veh-foreign-addterm'] },
    });
    expect(res.status).toBe(404);
    expect(junctionCountFor('veh-foreign-addterm')).toBe(0);
  });

  test('PUT /insurance/:id/terms/:termId re-pointing coverage to a foreign vehicleId → 404, original coverage intact', async () => {
    const ownVehicle = await seedVehicle(ctx);
    const { policyId, termId } = await seedPolicyWithTerm(ownVehicle);
    seedForeignVehicle('veh-foreign-updateterm');

    const res = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      vehicleCoverage: { vehicleIds: ['veh-foreign-updateterm'] },
    });
    expect(res.status).toBe(404);
    // The foreign vehicle never got a junction row, and the term keeps its original owned coverage.
    expect(junctionCountFor('veh-foreign-updateterm')).toBe(0);
    expect(junctionCountFor(ownVehicle)).toBe(1);
  });

  test('a term write with an owned vehicleId still succeeds', async () => {
    const ownVehicle = await seedVehicle(ctx);
    const { policyId } = await seedPolicyWithTerm(ownVehicle);
    const second = await seedVehicle(ctx);

    const res = await ctx.authed('POST', `/api/v1/insurance/${policyId}/terms`, {
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
      vehicleCoverage: { vehicleIds: [second] },
    });
    expect(res.status).toBe(201);
    expect(junctionCountFor(second)).toBe(1);
  });
});

describe('a term cost update replaces its premium expense', () => {
  /** Sums and counts the premium expenses linked to a term. */
  function premiumExpenses(termId: string): { count: number; total: number } {
    const rows = ctx.sqlite
      .query(
        "SELECT expense_amount AS amt FROM expenses WHERE source_type = 'insurance_term' AND source_id = ?"
      )
      .all(termId) as { amt: number }[];
    const total = rows.reduce((s, r) => s + (r.amt ?? 0), 0);
    return { count: rows.length, total: Math.round(total * 100) / 100 };
  }

  test('changing a term totalCost deletes the old premium siblings and re-creates them at the new cost', async () => {
    const v1 = await seedVehicle(ctx);
    const v2 = await seedVehicle(ctx);
    const created = await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Acme Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          totalCost: 1200,
          vehicleCoverage: { vehicleIds: [v1, v2] },
        },
      ],
    });
    const body = await json<DataEnvelope<PolicyRow>>(created);
    expect(created.status, JSON.stringify(body)).toBe(201);
    const policyId = body.data.id;
    const termId = body.data.terms[0].id;

    const before = premiumExpenses(termId);
    expect(before.count).toBe(2);
    expect(before.total).toBe(120000);

    const upd = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      totalCost: 1800,
      vehicleCoverage: { vehicleIds: [v1, v2] },
    });
    expect(upd.status, await upd.text()).toBeLessThan(300);

    const after = premiumExpenses(termId);
    expect(after.count).toBe(2);
    expect(after.total).toBe(180000);
  });
});
