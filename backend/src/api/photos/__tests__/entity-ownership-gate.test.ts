/**
 * Characterization tests for the photo-upload ownership gate
 * (`validateEntityOwnership` in photos/helpers.ts) across EVERY entity type.
 *
 * The photo routes are entityType-generic; the only authorization gate for an
 * upload (or any per-entity photo op) is that switch. `listPhotosForEntity`
 * calls it, so a GET /photos/:entityType/:entityId exercises the exact ownership
 * check an upload would — without needing a storage provider.
 *
 * WHY THIS EXISTS: helpers.ts carries its own ownership logic (a private
 * validateExpenseOwnership + inlined vehicle/policy checks) that DUPLICATES the
 * shared validators in utils/validation.ts — two implementations that can drift,
 * a security-adjacent smell. Before routing the switch through the shared
 * validators (the arch refactor), this pins the OBSERVABLE contract per type:
 *   - own entity            → 200 (gate passes; empty photo list)
 *   - another user's entity → 404 (NotFoundError; never leak existence)
 *   - non-existent entity   → 404
 *   - unknown entity type   → 400 (ValidationError)
 * The refactor must keep every one of these green (behavior-preserving).
 * `insurance_claim` is additionally covered end-to-end in
 * insurance/__tests__/claim-photos-http.test.ts; included here for symmetry.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

const OTHER_USER = 'other-owner';

beforeEach(async () => {
  ctx = await createTestApp();
  // A second user who owns the "foreign" entities the session user must not reach.
  ctx.sqlite.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${OTHER_USER}', 'other@test.com', 'Other Owner')`
  );
});
afterEach(() => ctx.close());

// --- Direct row seeders (no storage provider needed for a GET) --------------

function seedVehicle(id: string, userId: string): void {
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)`,
    [id, userId]
  );
}

function seedExpense(id: string, vehicleId: string, userId: string): void {
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES (?, ?, ?, 'maintenance', 1700000000, 100.0)`,
    [id, vehicleId, userId]
  );
}

function seedOdometerEntry(id: string, vehicleId: string, userId: string): void {
  ctx.sqlite.run(
    `INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at)
     VALUES (?, ?, ?, 50000, 1700000000)`,
    [id, vehicleId, userId]
  );
}

function seedPolicy(id: string, userId: string): void {
  ctx.sqlite.run(
    `INSERT INTO insurance_policies (id, user_id, company) VALUES (?, ?, 'Acme Mutual')`,
    [id, userId]
  );
}

/** GET a per-entity photo list — exercises validateEntityOwnership for entityType. */
async function getPhotos(entityType: string, entityId: string): Promise<Response> {
  return ctx.authed('GET', `/api/v1/photos/${entityType}/${entityId}`);
}

/**
 * Each case seeds an OWNED entity (session user) and a FOREIGN one (OTHER_USER),
 * then asserts the gate's three observable outcomes.
 */
const cases: Array<{
  entityType: string;
  seed: (id: string, userId: string) => void;
}> = [
  { entityType: 'vehicle', seed: (id, userId) => seedVehicle(id, userId) },
  {
    entityType: 'expense',
    seed: (id, userId) => {
      const vehId = `veh-for-${id}`;
      seedVehicle(vehId, userId);
      seedExpense(id, vehId, userId);
    },
  },
  { entityType: 'insurance_policy', seed: (id, userId) => seedPolicy(id, userId) },
  {
    entityType: 'odometer_entry',
    seed: (id, userId) => {
      const vehId = `veh-for-${id}`;
      seedVehicle(vehId, userId);
      seedOdometerEntry(id, vehId, userId);
    },
  },
];

describe('photo-upload ownership gate (validateEntityOwnership) per entity type', () => {
  for (const { entityType, seed } of cases) {
    describe(entityType, () => {
      test('own entity passes the gate (200, empty list)', async () => {
        const ownId = `${entityType}-own`;
        seed(ownId, ctx.user.id);

        const res = await getPhotos(entityType, ownId);
        expect(res.status, await res.clone().text()).toBe(200);
        const body = await json<DataEnvelope<unknown[]>>(res);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data).toHaveLength(0);
      });

      test("another user's entity is rejected (404, no existence leak)", async () => {
        const foreignId = `${entityType}-foreign`;
        seed(foreignId, OTHER_USER);

        const res = await getPhotos(entityType, foreignId);
        expect(res.status).toBe(404);
      });

      test('a non-existent entity is rejected (404)', async () => {
        const res = await getPhotos(entityType, `${entityType}-missing`);
        expect(res.status).toBe(404);
      });
    });
  }

  test('an unknown entity type is rejected (400 ValidationError)', async () => {
    const res = await getPhotos('not_a_real_type', 'whatever');
    expect(res.status).toBe(400);
  });

  test('anonymous access is unauthorized (401)', async () => {
    const res = await ctx.anon('GET', '/api/v1/photos/vehicle/any-id');
    expect(res.status).toBe(401);
  });
});
