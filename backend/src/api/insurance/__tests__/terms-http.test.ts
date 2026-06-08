/**
 * In-process HTTP tests for the insurance TERM update route — through the REAL
 * stack (middleware → auth → zValidator → handler → repository → DB).
 *
 * Focus: the clear-optional-field semantics on PUT /insurance/:id/terms/:termId.
 * Same data-loss class as claims (see claims-http.test.ts): an emptied optional
 * field must be sendable as null to clear the column; omitting it must preserve
 * the prior value. createTestApp() rewrites process.env + dynamic-imports the
 * DB-bound modules, so this file imports only the harness.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

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
async function seedPolicyWithTerm(vehicleId: string): Promise<{ policyId: string; termId: string }> {
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

describe('insurance term update HTTP route — clear-optional-field semantics', () => {
  test('explicit null clears a term field; omitting it preserves the prior value', async () => {
    const vehicleId = await seedVehicle();
    const { policyId, termId } = await seedPolicyWithTerm(vehicleId);

    // Omitting fields preserves them (only policyNumber changes here).
    const partial = await ctx.authed('PUT', `/api/v1/insurance/${policyId}/terms/${termId}`, {
      policyNumber: 'POL-456',
    });
    const partialBody = await json<DataEnvelope<PolicyRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    const afterPartial = partialBody.data.terms.find((t) => t.id === termId);
    expect(afterPartial?.policyNumber).toBe('POL-456');
    expect(afterPartial?.deductibleAmount).toBe(500); // preserved
    expect(afterPartial?.agentName).toBe('Pat Agent'); // preserved

    // Explicit null clears the optional fields (user emptied them in the form).
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
    const vehicleId = await seedVehicle();
    const { policyId } = await seedPolicyWithTerm(vehicleId);

    // Set notes.
    const set = await ctx.authed('PUT', `/api/v1/insurance/${policyId}`, {
      notes: 'Bundled with home insurance',
    });
    const setBody = await json<DataEnvelope<PolicyRow>>(set);
    expect(set.status, JSON.stringify(setBody)).toBe(200);
    expect(setBody.data.notes).toBe('Bundled with home insurance');

    // Omitting notes (company-only update) preserves it.
    const partial = await ctx.authed('PUT', `/api/v1/insurance/${policyId}`, {
      company: 'Renamed Mutual',
    });
    const partialBody = await json<DataEnvelope<PolicyRow>>(partial);
    expect(partial.status, JSON.stringify(partialBody)).toBe(200);
    expect(partialBody.data.notes).toBe('Bundled with home insurance'); // preserved

    // Explicit null clears notes (the user emptied the field).
    const cleared = await ctx.authed('PUT', `/api/v1/insurance/${policyId}`, {
      notes: null,
    });
    const clearedBody = await json<DataEnvelope<PolicyRow>>(cleared);
    expect(cleared.status, JSON.stringify(clearedBody)).toBe(200);
    expect(clearedBody.data.notes).toBeNull();
  });
});
