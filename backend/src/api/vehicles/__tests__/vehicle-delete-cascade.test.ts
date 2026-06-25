/**
 * In-process HTTP tests for vehicle deletion CASCADE — through the REAL stack.
 *
 * When a vehicle is deleted, the DB FK-cascade removes its expenses and odometer
 * entries (expenses.vehicle_id / odometer_entries.vehicle_id are ON DELETE
 * cascade). But the `photos` table links to entities by (entity_type, entity_id)
 * STRINGS — it has NO foreign key to those tables — so nothing cascades the
 * photos of the deleted expenses/odometer entries. The vehicle route only cleans
 * its OWN ('vehicle') photos. Result: orphaned photo rows (and their external
 * storage files) for every expense/odometer photo on the deleted vehicle.
 *
 * These tests pin the desired behavior: after deleting a vehicle, NO photo rows
 * for that vehicle's expenses or odometer entries remain.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle as seedVehicleShared } from '../../../test-helpers/seed';
import { ENTITY_TO_CATEGORY } from '../../providers/domains/storage/storage-provider';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Insert a photo row directly (no storage provider needed for a cascade test). */
function seedPhoto(opts: { id: string; entityType: string; entityId: string }): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [opts.id, ctx.user.id, opts.entityType, opts.entityId, `${opts.id}.jpg`]
  );
}

function photoCount(entityType: string, entityId: string): number {
  const row = ctx.sqlite
    .query(`SELECT COUNT(*) AS n FROM photos WHERE entity_type = ? AND entity_id = ?`)
    .get(entityType, entityId) as { n: number };
  return row.n;
}

// This file's fixture is the shared default vehicle (Toyota Camry 2022); converge onto the shared
// test-helpers/seed seedVehicle (arch convergence, Angelo-approved) — no opts needed since the default
// matches exactly. A thin no-arg wrapper keeps the call sites untouched.
const seedVehicle = (): Promise<string> => seedVehicleShared(ctx);

async function seedExpense(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/expenses', {
    vehicleId,
    category: 'fuel',
    expenseAmount: 50,
    date: '2024-06-01T00:00:00.000Z',
    volume: 10,
    mileage: 30000,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('vehicle deletion cascades photo cleanup to dependent entities', () => {
  test("deleting a vehicle removes its expenses' photo rows (no orphans)", async () => {
    const vehicleId = await seedVehicle();
    const expenseId = await seedExpense(vehicleId);

    // Attach a receipt photo to the expense, and a cover photo to the vehicle.
    seedPhoto({ id: 'exp-photo', entityType: 'expense', entityId: expenseId });
    seedPhoto({ id: 'veh-photo', entityType: 'vehicle', entityId: vehicleId });
    expect(photoCount('expense', expenseId)).toBe(1);
    expect(photoCount('vehicle', vehicleId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // The expense itself is FK-cascade-deleted...
    const expphotos = photoCount('expense', expenseId);
    const vehphotos = photoCount('vehicle', vehicleId);
    // ...and its photo row must be cleaned up too (this is the orphan bug).
    expect(expphotos, 'expense photo rows should be cleaned up on vehicle delete').toBe(0);
    expect(vehphotos, 'vehicle photo rows should be cleaned up on vehicle delete').toBe(0);
  });

  test('deleting a single expense directly removes its photo rows (no orphans)', async () => {
    const vehicleId = await seedVehicle();
    const expenseId = await seedExpense(vehicleId);
    seedPhoto({ id: 'exp-photo-direct', entityType: 'expense', entityId: expenseId });
    expect(photoCount('expense', expenseId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/expenses/${expenseId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      photoCount('expense', expenseId),
      'expense photo rows should be cleaned up on direct expense delete'
    ).toBe(0);
  });

  // trips-location (C202 schema + C207 cascade guard): trips.vehicle_id is ON DELETE cascade (migration
  // 0007; the raw-SQL cascade is unit-pinned in migration-0007.test.ts). This pins it END-TO-END through the
  // REAL vehicle-delete ROUTE — a trip is gone after its vehicle is deleted (no orphaned trip rows leaking
  // into analytics / the mileage-summary, NORTH_STAR #2). Trips are NOT a photo-upload entity type (the
  // C207 bug-scout verified `trip` is absent from the photo allowlist + ENTITY_TO_CATEGORY, so the
  // photo-cleanup block correctly needs no trips leg; the C452 guard above keeps that drift-proof if trip
  // photos are ever added). Seed the trip directly (no create route until T3 — the cascade is FK-level).
  test('deleting a vehicle CASCADE-removes its trips (no orphaned trip rows)', async () => {
    const vehicleId = await seedVehicle();
    ctx.sqlite.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
       VALUES ('trip-casc', ?, ?, 1000, 1080, 'business', 1700000000)`,
      [vehicleId, ctx.user.id]
    );
    const tripCount = (vid: string): number =>
      (
        ctx.sqlite.query('SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?').get(vid) as {
          n: number;
        }
      ).n;
    expect(tripCount(vehicleId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // The vehicle's trip is FK-cascade-deleted — no orphan survives the delete.
    expect(tripCount(vehicleId), 'trip rows should cascade away with their vehicle').toBe(0);
  });

  test("deleting a vehicle removes its odometer entries' photo rows (no orphans)", async () => {
    const vehicleId = await seedVehicle();

    // Create an odometer entry for the vehicle (POST /api/v1/odometer/:vehicleId).
    const odo = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 31000,
      recordedAt: '2024-06-02T00:00:00.000Z',
    });
    const odoBody = await json<DataEnvelope<{ id: string }>>(odo);
    expect(odo.status, JSON.stringify(odoBody)).toBeLessThan(300);
    const odoId = odoBody.data.id;

    seedPhoto({ id: 'odo-photo', entityType: 'odometer_entry', entityId: odoId });
    expect(photoCount('odometer_entry', odoId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      photoCount('odometer_entry', odoId),
      'odometer-entry photo rows should be cleaned up on vehicle delete'
    ).toBe(0);
  });
});

// #97 FIXED (C40, Angelo-approved): reminder_vehicles.vehicleId is onDelete:'cascade', so deleting a
// vehicle removes its junction row — but the reminder ROW survives. Pre-fix a reminder linked to ONLY that
// vehicle was left is_active=1 with ZERO vehicles (the trigger skipped it 'no_vehicles' forever, a silent
// never-firing orphan still shown active). The vehicle-delete route now calls
// reminderRepository.deactivateVehicleless(userId) after the delete, flipping any now-vehicleless active
// reminder to inactive. A MULTI-vehicle reminder is unaffected — it keeps its remaining vehicles + stays
// active. (This was a characterization test of the buggy state; flipped to the fixed behavior at C40.)
describe('#97 — a single-vehicle reminder is auto-deactivated when its only vehicle is deleted', () => {
  function reminderRow(id: string): { is_active: number } | null {
    return (
      (ctx.sqlite.query('SELECT is_active FROM reminders WHERE id = ?').get(id) as {
        is_active: number;
      } | null) ?? null
    );
  }
  function junctionCount(reminderId: string): number {
    const row = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM reminder_vehicles WHERE reminder_id = ?')
      .get(reminderId) as { n: number };
    return row.n;
  }
  /** Seed a time reminder linked to the given vehicles (mileage/time API surface is partial). */
  function seedReminder(id: string, vehicleIds: string[]): void {
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES (?, ?, 'Registration', 'notification', 'automatic', 'yearly', 'time', 0, 0, 1)`,
      [id, ctx.user.id]
    );
    for (const v of vehicleIds) {
      ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
        id,
        v,
      ]);
    }
  }

  test('the now-vehicleless reminder is DEACTIVATED (no longer a silent no_vehicles orphan)', async () => {
    const vehicleId = await seedVehicle();
    seedReminder('rm-orphan', [vehicleId]);
    expect(junctionCount('rm-orphan')).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // The junction cascaded away AND the now-vehicleless reminder was deactivated (the #97 fix).
    expect(junctionCount('rm-orphan')).toBe(0);
    expect(reminderRow('rm-orphan')?.is_active).toBe(0);

    // It no longer appears in the trigger run at all (not active → not even evaluated/skipped).
    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body =
      await json<DataEnvelope<{ skipped: Array<{ reminderId: string; reason: string }> }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.skipped.some((s) => s.reminderId === 'rm-orphan')).toBe(false);
  });

  test('a MULTI-vehicle reminder is NOT deactivated — it keeps its remaining vehicle', async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    seedReminder('rm-multi', [v1, v2]);
    expect(junctionCount('rm-multi')).toBe(2);

    // Delete only ONE of the two covered vehicles.
    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v1}`);
    expect(del.status, await del.text()).toBe(200);

    // The reminder still has v2 → it stays active (not over-deactivated).
    expect(junctionCount('rm-multi')).toBe(1);
    expect(reminderRow('rm-multi')?.is_active).toBe(1);
  });
});

// #88 FIXED (C48, Angelo-approved): a reminder's `expenseSplitConfig` is a JSON blob, NOT FK-managed like
// the reminder_vehicles junction — so when a vehicle is deleted, the junction row cascades but the blob
// still NAMES the dead vehicleId. On the next trigger createExpenseFromReminder builds a split sibling for
// that dead id → an FK violation that (the C151 async-tx footgun) leaves the surviving legs half-committed
// — a partial/inconsistent expense group every trigger. The vehicle-delete route now calls
// reminderRepository.pruneSplitConfigsForDeletedVehicle(userId, id) BEFORE deactivateVehicleless: it drops
// the deleted leg + renormalizes (≥2 legs remain) or clears the blob (<2 → single-vehicle fallback).
describe('#88 — a deleted vehicle is pruned from reminders’ expenseSplitConfig blob', () => {
  /** Seed an EXPENSE reminder with a split-config blob + matching junction rows. */
  function seedSplitReminder(id: string, config: object, vehicleIds: string[]): void {
    ctx.sqlite.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date,
          is_active, expense_category, expense_amount, expense_split_config)
       VALUES (?, ?, 'Monthly wash', 'expense', 'automatic', 'monthly', 'time', 0, 0, 1, 'misc', 60,
          ?)`,
      [id, ctx.user.id, JSON.stringify(config)]
    );
    for (const v of vehicleIds) {
      ctx.sqlite.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
        id,
        v,
      ]);
    }
  }
  function splitConfig(
    id: string
  ): { method: string; vehicleIds?: string[]; allocations?: unknown[] } | null {
    const row = ctx.sqlite
      .query('SELECT expense_split_config AS c FROM reminders WHERE id = ?')
      .get(id) as { c: string | null } | null;
    return row?.c ? JSON.parse(row.c) : null;
  }

  test("an 'even' split drops the deleted vehicle's leg; the surviving legs renormalize", async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const v3 = await seedVehicle();
    seedSplitReminder('rm-even', { method: 'even', vehicleIds: [v1, v2, v3] }, [v1, v2, v3]);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`);
    expect(del.status, await del.text()).toBe(200);

    const cfg = splitConfig('rm-even');
    expect(cfg?.method).toBe('even');
    // The dead vehicle is gone from the blob; the other two remain (no FK-violating leg on next trigger).
    expect(cfg?.vehicleIds?.sort()).toEqual([v1, v3].sort());
    expect(cfg?.vehicleIds).not.toContain(v2);
  });

  test("a 'percentage' split drops the leg + RESCALES survivors back to 100%", async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    seedSplitReminder(
      'rm-pct',
      {
        method: 'percentage',
        allocations: [
          { vehicleId: v1, percentage: 25 },
          { vehicleId: v2, percentage: 75 },
        ],
      },
      [v1, v2]
    );

    // Delete v1 → only v2 would remain (<2 legs) → the blob is CLEARED (single-vehicle fallback).
    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v1}`);
    expect(del.status, await del.text()).toBe(200);
    expect(
      splitConfig('rm-pct'),
      'a <2-leg split collapses to null (junction-driven single path)'
    ).toBeNull();
  });

  test('a 3-way percentage split keeps ≥2 legs → rescaled to sum 100, dead leg gone', async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const v3 = await seedVehicle();
    seedSplitReminder(
      'rm-pct3',
      {
        method: 'percentage',
        allocations: [
          { vehicleId: v1, percentage: 25 },
          { vehicleId: v2, percentage: 25 },
          { vehicleId: v3, percentage: 50 },
        ],
      },
      [v1, v2, v3]
    );

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`);
    expect(del.status, await del.text()).toBe(200);

    const cfg = splitConfig('rm-pct3') as {
      method: string;
      allocations: { vehicleId: string; percentage: number }[];
    } | null;
    expect(cfg?.method).toBe('percentage');
    expect(cfg?.allocations.map((a) => a.vehicleId).sort()).toEqual([v1, v3].sort());
    expect(cfg?.allocations.some((a) => a.vehicleId === v2)).toBe(false);
    // Survivors (was 25 + 50 = 75) rescale back to 100.
    expect(cfg?.allocations.reduce((s, a) => s + a.percentage, 0)).toBeCloseTo(100, 5);
  });

  test('an unrelated split reminder is untouched when a non-member vehicle is deleted', async () => {
    const v1 = await seedVehicle();
    const v2 = await seedVehicle();
    const other = await seedVehicle();
    seedSplitReminder('rm-keep', { method: 'even', vehicleIds: [v1, v2] }, [v1, v2]);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${other}`);
    expect(del.status, await del.text()).toBe(200);

    const cfg = splitConfig('rm-keep');
    expect(cfg?.vehicleIds?.sort()).toEqual([v1, v2].sort()); // unchanged
  });
});

// C366 deep-review (CERTIFIED CLEAN — pins an unguarded data-safety invariant). insurance_claims.vehicleId
// is onDelete:'set null' (schema.ts:188), deliberately UNLIKE the cascade FKs above: a claim is a financial/
// legal record (payoutAmount, claimDate, status) that belongs to its POLICY (policyId cascades), NOT to the
// vehicle — so deleting a vehicle must PRESERVE the claim with vehicleId nulled, never destroy it (NORTH_STAR
// #1: no silent loss). Nothing pinned this; a regression flipping that FK to 'cascade' (or a manual cleanup
// that over-deletes) would silently wipe a user's claim history on an unrelated vehicle delete. This anchors
// survival + the null so such a change turns RED.
describe('C366 — deleting a vehicle PRESERVES its insurance claims (vehicleId set null, not cascade-deleted)', () => {
  function claimRow(
    id: string
  ): { vehicle_id: string | null; policy_id: string; payout_amount: number } | null {
    return (
      (ctx.sqlite
        .query('SELECT vehicle_id, policy_id, payout_amount FROM insurance_claims WHERE id = ?')
        .get(id) as {
        vehicle_id: string | null;
        policy_id: string;
        payout_amount: number;
      } | null) ?? null
    );
  }

  test('the claim row SURVIVES with vehicle_id nulled; policy link + payout are intact', async () => {
    const vehicleId = await seedVehicle();

    // Seed a policy (claims FK→policies is notNull cascade) and a claim referencing the vehicle.
    ctx.sqlite.run(
      `INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES ('pol-claim', ?, 'Geico', 1)`,
      [ctx.user.id]
    );
    ctx.sqlite.run(
      `INSERT INTO insurance_claims (id, policy_id, vehicle_id, claim_date, claim_type, status, payout_amount)
       VALUES ('clm-1', 'pol-claim', ?, 1700000000, 'collision', 'settled', 2500.0)`,
      [vehicleId]
    );
    expect(claimRow('clm-1')?.vehicle_id).toBe(vehicleId);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    // The financial record must NOT be lost: row survives, vehicle_id is nulled, policy + payout untouched.
    const after = claimRow('clm-1');
    expect(after, 'claim must survive vehicle delete (set null, not cascade)').not.toBeNull();
    expect(after?.vehicle_id).toBeNull();
    expect(after?.policy_id).toBe('pol-claim');
    expect(after?.payout_amount).toBe(2500.0);
  });
});

// ---------------------------------------------------------------------------
// C452 symmetry guard (the C302 restore-table-coverage pattern, on the photo-cascade side). The
// vehicle-delete handler HARD-CODES which photo-bearing entity types it reaps (vehicle + expense +
// odometer_entry — the three above). ENTITY_TO_CATEGORY is the registry of EVERY photo-bearing entity
// type. The omitted ones (insurance_policy, insurance_claim) are correctly excluded because those
// entities SURVIVE a vehicle delete (the policy isn't a vehicle child; the claim is set-null, C366) —
// but nothing pins that correspondence. If a future photo-bearing entity type is added that IS a
// vehicle FK-cascade child (or an existing one's FK flips to cascade) without a matching cleanup call,
// its photo rows + external bytes silently orphan (the #34/C280 leak class the handler exists to
// prevent) with NO failing test. This makes the correspondence DRIFT-PROOF: every ENTITY_TO_CATEGORY
// key must be either reaped by the delete handler OR in the documented "survives a vehicle delete" set.
describe('C452 — every photo-bearing entity type is reaped on vehicle-delete OR documented as surviving', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const VEHICLE_ROUTES_SRC = readFileSync(join(HERE, '..', 'routes.ts'), 'utf-8');

  // Photo-bearing entity types that are NOT removed by a vehicle delete (so the handler MUST NOT, and
  // does not, reap their photos here): the policy isn't a vehicle child, and a claim's vehicleId is
  // ON DELETE SET NULL (C366) — the claim row + its photos survive.
  const SURVIVES_VEHICLE_DELETE = new Set(['insurance_policy', 'insurance_claim']);

  test('the vehicle-delete handler cleans photos for exactly the photo-entity types it should', () => {
    const unaccounted: string[] = [];
    for (const entityType of Object.keys(ENTITY_TO_CATEGORY)) {
      if (SURVIVES_VEHICLE_DELETE.has(entityType)) continue; // (b) survives → must NOT be reaped here
      // (a) a vehicle-cascade child → the handler must reap its photos. Both helpers take the entity
      // type as the first string arg: deleteAllPhotosForEntity('vehicle',…) / deletePhotosForEntities('expense',…).
      const reaped =
        VEHICLE_ROUTES_SRC.includes(`deleteAllPhotosForEntity('${entityType}'`) ||
        VEHICLE_ROUTES_SRC.includes(`deletePhotosForEntities('${entityType}'`);
      if (!reaped) unaccounted.push(entityType);
    }

    expect(
      unaccounted,
      `Photo-bearing entity type(s) neither reaped by the vehicle-delete handler nor documented as ` +
        `surviving a vehicle delete. If it's a vehicle FK-cascade child, add a deletePhotosForEntities ` +
        `cleanup call in routes.ts delete /:id (its photo rows + external bytes would otherwise orphan, ` +
        `the #34 leak class); if it survives, add it to SURVIVES_VEHICLE_DELETE:\n${unaccounted.join('\n')}`
    ).toEqual([]);
  });

  test('the guard is live: ENTITY_TO_CATEGORY has the photo-entity types it scans', () => {
    // Non-vacuity floor — if the registry were empty/renamed away, the loop above would vacuously pass.
    expect(Object.keys(ENTITY_TO_CATEGORY).length).toBeGreaterThanOrEqual(5);
    expect(ENTITY_TO_CATEGORY.vehicle).toBeDefined();
  });
});
