/**
 * Shared test seeders for the createTestApp() HTTP harness (arch convergence, Angelo-approved
 * 2026-06-23). `seedVehicle` was hand-redeclared in 50+ HTTP-harness test files with 7 slightly
 * different signatures (no-arg, nickname-only, make-only, make/model/year, an extra-fields bag, …);
 * this is the ONE shared seeder they converge onto, ONE domain migrated per arch cycle (never a
 * big-bang — arch rules 1/2). Each migrated call site passes an options bag reproducing its exact
 * prior vehicle so behavior is preserved (green→green).
 *
 * It drives the REAL route (`POST /api/v1/vehicles`) over the test app's authed session — identical
 * to every inlined copy — and returns the created vehicle id. Asserts a <300 status with the body in
 * the message (the same guard every copy used), so a seeding failure surfaces at the seed call, not
 * later. Test-only; never imported by production code.
 */

import { expect } from 'bun:test';
import { type DataEnvelope, json, type TestApp } from './http-client';

/**
 * Options for {@link seedVehicle}. Every field is optional; the defaults reproduce the most common
 * inlined shape (`{ make: 'Toyota', model: 'Camry', year: 2022 }`). `nickname` and any further
 * vehicle-create fields (`initialMileage`, `unitPreferences`, …) ride through `extra` so a call site
 * can mirror its exact prior payload without widening this signature.
 */
export interface SeedVehicleOptions {
  make?: string;
  model?: string;
  year?: number;
  nickname?: string;
  /** Any additional `POST /vehicles` body fields the call site set (merged last). */
  extra?: Record<string, unknown>;
}

/**
 * Create a vehicle via the real route on `ctx`'s authed session and return its id. Mirrors the
 * inlined `seedVehicle` helpers exactly: a single authed POST, a <300 status assertion carrying the
 * response body, then `body.data.id`.
 */
export async function seedVehicle(ctx: TestApp, opts: SeedVehicleOptions = {}): Promise<string> {
  const { make = 'Toyota', model = 'Camry', year = 2022, nickname, extra } = opts;
  const body: Record<string, unknown> = {
    make,
    model,
    year,
    ...(nickname ? { nickname } : {}),
    ...extra,
  };
  const res = await ctx.authed('POST', '/api/v1/vehicles', body);
  const parsed = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(parsed)).toBeLessThan(300);
  return parsed.data.id;
}
