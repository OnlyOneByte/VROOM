import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import { ENTITY_TO_CATEGORY } from '../../providers/domains/storage/storage-provider';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedPhoto(opts: {
  id: string;
  entityType: string;
  entityId: string;
}): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
    [opts.id, ctx.user.id, opts.entityType, opts.entityId, `${opts.id}.jpg`]
  );
}

async function photoCount(entityType: string, entityId: string): Promise<number> {
  const row = (await ctx.sql.get(
    `SELECT COUNT(*) AS n FROM photos WHERE entity_type = ? AND entity_id = ?`,
    [entityType, entityId]
  )) as { n: number };
  return row.n;
}

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
  test('deleting a single expense directly removes its photo rows (no orphans)', async () => {
    const vehicleId = await seedVehicle(ctx);
    const expenseId = await seedExpense(vehicleId);
    await seedPhoto({ id: 'exp-photo-direct', entityType: 'expense', entityId: expenseId });
    expect(await photoCount('expense', expenseId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/expenses/${expenseId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(
      await photoCount('expense', expenseId),
      'expense photo rows should be cleaned up on direct expense delete'
    ).toBe(0);
  });

  test('deleting a vehicle cascades to its trips (no orphaned trip rows)', async () => {
    const vehicleId = await seedVehicle(ctx);
    await ctx.sql.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
       VALUES ('trip-casc', ?, ?, 1000, 1080, 'business', 1700000000)`,
      [vehicleId, ctx.user.id]
    );
    const tripCount = async (vid: string): Promise<number> =>
      (
        (await ctx.sql.get('SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?', [vid])) as {
          n: number;
        }
      ).n;
    expect(await tripCount(vehicleId)).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(await tripCount(vehicleId), 'trip rows should cascade away with their vehicle').toBe(0);
  });
});

describe('a single-vehicle reminder is auto-deactivated when its only vehicle is deleted', () => {
  async function reminderRow(id: string): Promise<{ is_active: number } | null> {
    return (
      ((await ctx.sql.get('SELECT is_active FROM reminders WHERE id = ?', [id])) as {
        is_active: number;
      } | null) ?? null
    );
  }
  async function junctionCount(reminderId: string): Promise<number> {
    const row = (await ctx.sql.get(
      'SELECT COUNT(*) AS n FROM reminder_vehicles WHERE reminder_id = ?',
      [reminderId]
    )) as { n: number };
    return row.n;
  }
  async function seedReminder(id: string, vehicleIds: string[]): Promise<void> {
    await ctx.sql.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES (?, ?, 'Registration', 'notification', 'automatic', 'yearly', 'time', 0, 0, TRUE)`,
      [id, ctx.user.id]
    );
    for (const v of vehicleIds) {
      await ctx.sql.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
        id,
        v,
      ]);
    }
  }

  test('the now-vehicleless reminder is deactivated', async () => {
    const vehicleId = await seedVehicle(ctx);
    await seedReminder('rm-orphan', [vehicleId]);
    expect(await junctionCount('rm-orphan')).toBe(1);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    expect(await junctionCount('rm-orphan')).toBe(0);
    expect((await reminderRow('rm-orphan'))?.is_active).toBe(0);

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    const body =
      await json<DataEnvelope<{ skipped: Array<{ reminderId: string; reason: string }> }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.skipped.some((s) => s.reminderId === 'rm-orphan')).toBe(false);
  });

  test('a MULTI-vehicle reminder is NOT deactivated — it keeps its remaining vehicle', async () => {
    const v1 = await seedVehicle(ctx);
    const v2 = await seedVehicle(ctx);
    await seedReminder('rm-multi', [v1, v2]);
    expect(await junctionCount('rm-multi')).toBe(2);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v1}`);
    expect(del.status, await del.text()).toBe(200);

    expect(await junctionCount('rm-multi')).toBe(1);
    expect((await reminderRow('rm-multi'))?.is_active).toBe(1);
  });
});

describe('a deleted vehicle is pruned from reminders’ expenseSplitConfig blob', () => {
  async function seedSplitReminder(
    id: string,
    config: object,
    vehicleIds: string[]
  ): Promise<void> {
    await ctx.sql.run(
      `INSERT INTO reminders
         (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date,
          is_active, expense_category, expense_amount, expense_split_config)
       VALUES (?, ?, 'Monthly wash', 'expense', 'automatic', 'monthly', 'time', 0, 0, TRUE, 'misc', 60,
          ?)`,
      [id, ctx.user.id, JSON.stringify(config)]
    );
    for (const v of vehicleIds) {
      await ctx.sql.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES (?, ?)`, [
        id,
        v,
      ]);
    }
  }
  async function splitConfig(
    id: string
  ): Promise<{ method: string; vehicleIds?: string[]; allocations?: unknown[] } | null> {
    const row = (await ctx.sql.get('SELECT expense_split_config AS c FROM reminders WHERE id = ?', [
      id,
    ])) as { c: string | null } | null;
    return row?.c ? JSON.parse(row.c) : null;
  }

  test("an 'even' split drops the deleted vehicle's leg; the surviving legs renormalize", async () => {
    const v1 = await seedVehicle(ctx);
    const v2 = await seedVehicle(ctx);
    const v3 = await seedVehicle(ctx);
    await seedSplitReminder('rm-even', { method: 'even', vehicleIds: [v1, v2, v3] }, [v1, v2, v3]);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v2}`);
    expect(del.status, await del.text()).toBe(200);

    const cfg = await splitConfig('rm-even');
    expect(cfg?.method).toBe('even');
    expect(cfg?.vehicleIds?.sort()).toEqual([v1, v3].sort());
    expect(cfg?.vehicleIds).not.toContain(v2);
  });

  test("a 'percentage' split drops the leg + RESCALES survivors back to 100%", async () => {
    const v1 = await seedVehicle(ctx);
    const v2 = await seedVehicle(ctx);
    await seedSplitReminder(
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

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${v1}`);
    expect(del.status, await del.text()).toBe(200);
    expect(
      await splitConfig('rm-pct'),
      'a <2-leg split collapses to null (junction-driven single path)'
    ).toBeNull();
  });

  test('a 3-way percentage split keeps ≥2 legs → rescaled to sum 100, dead leg gone', async () => {
    const v1 = await seedVehicle(ctx);
    const v2 = await seedVehicle(ctx);
    const v3 = await seedVehicle(ctx);
    await seedSplitReminder(
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

    const cfg = (await splitConfig('rm-pct3')) as {
      method: string;
      allocations: { vehicleId: string; percentage: number }[];
    } | null;
    expect(cfg?.method).toBe('percentage');
    expect(cfg?.allocations.map((a) => a.vehicleId).sort()).toEqual([v1, v3].sort());
    expect(cfg?.allocations.some((a) => a.vehicleId === v2)).toBe(false);
    expect(cfg?.allocations.reduce((s, a) => s + a.percentage, 0)).toBeCloseTo(100, 5);
  });

  test('an unrelated split reminder is untouched when a non-member vehicle is deleted', async () => {
    const v1 = await seedVehicle(ctx);
    const v2 = await seedVehicle(ctx);
    const other = await seedVehicle(ctx);
    await seedSplitReminder('rm-keep', { method: 'even', vehicleIds: [v1, v2] }, [v1, v2]);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${other}`);
    expect(del.status, await del.text()).toBe(200);

    const cfg = await splitConfig('rm-keep');
    expect(cfg?.vehicleIds?.sort()).toEqual([v1, v2].sort());
  });
});

// insurance_claims.vehicle_id is nulled on delete, not cascaded: claims are financial records.
describe('deleting a vehicle PRESERVES its insurance claims (vehicleId set null, not cascade-deleted)', () => {
  async function claimRow(
    id: string
  ): Promise<{ vehicle_id: string | null; policy_id: string; payout_amount: number } | null> {
    return (
      ((await ctx.sql.get(
        'SELECT vehicle_id, policy_id, payout_amount FROM insurance_claims WHERE id = ?',
        [id]
      )) as {
        vehicle_id: string | null;
        policy_id: string;
        payout_amount: number;
      } | null) ?? null
    );
  }

  test('the claim row SURVIVES with vehicle_id nulled; policy link + payout are intact', async () => {
    const vehicleId = await seedVehicle(ctx);

    await ctx.sql.run(
      `INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES ('pol-claim', ?, 'Geico', TRUE)`,
      [ctx.user.id]
    );
    await ctx.sql.run(
      `INSERT INTO insurance_claims (id, policy_id, vehicle_id, claim_date, claim_type, status, payout_amount)
       VALUES ('clm-1', 'pol-claim', ?, 1700000000, 'collision', 'settled', 2500.0)`,
      [vehicleId]
    );
    expect((await claimRow('clm-1'))?.vehicle_id).toBe(vehicleId);

    const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
    expect(del.status, await del.text()).toBe(200);

    const after = await claimRow('clm-1');
    expect(after, 'claim must survive vehicle delete (set null, not cascade)').not.toBeNull();
    expect(after?.vehicle_id).toBeNull();
    expect(after?.policy_id).toBe('pol-claim');
    expect(after?.payout_amount).toBe(2500.0);
  });
});

describe('vehicle delete handles photos for every photo-bearing entity type', () => {
  type Seeder = (vehicleId: string) => Promise<string>;

  async function seedOdometerEntry(vehicleId: string): Promise<string> {
    const res = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 31000,
      recordedAt: '2024-06-02T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBeLessThan(300);
    return body.data.id;
  }

  async function seedPolicy(): Promise<string> {
    await ctx.sql.run(
      `INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES ('pol-photo', ?, 'Geico', TRUE)`,
      [ctx.user.id]
    );
    return 'pol-photo';
  }

  const REAPED: Record<string, Seeder> = {
    vehicle: async (vehicleId) => vehicleId,
    expense: seedExpense,
    odometer_entry: seedOdometerEntry,
  };

  const SURVIVES: Record<string, Seeder> = {
    insurance_policy: async () => await seedPolicy(),
    insurance_claim: async (vehicleId) => {
      const policyId = await seedPolicy();
      await ctx.sql.run(
        `INSERT INTO insurance_claims (id, policy_id, vehicle_id, claim_date, claim_type, status)
         VALUES ('clm-photo', ?, ?, 1700000000, 'collision', 'open')`,
        [policyId, vehicleId]
      );
      return 'clm-photo';
    },
  };

  test('every photo entity type is classified as reaped or surviving', () => {
    const classified = new Set([...Object.keys(REAPED), ...Object.keys(SURVIVES)]);
    expect(Object.keys(ENTITY_TO_CATEGORY).filter((t) => !classified.has(t))).toEqual([]);
  });

  for (const [entityType, seed] of Object.entries(REAPED)) {
    test(`deleting a vehicle removes its ${entityType} photo rows`, async () => {
      const vehicleId = await seedVehicle(ctx);
      const entityId = await seed(vehicleId);
      await seedPhoto({ id: `photo-${entityType}`, entityType, entityId });
      expect(await photoCount(entityType, entityId)).toBe(1);

      const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
      expect(del.status, await del.text()).toBe(200);

      expect(await photoCount(entityType, entityId)).toBe(0);
    });
  }

  for (const [entityType, seed] of Object.entries(SURVIVES)) {
    test(`deleting a vehicle keeps its ${entityType} photo rows`, async () => {
      const vehicleId = await seedVehicle(ctx);
      const entityId = await seed(vehicleId);
      await seedPhoto({ id: `photo-${entityType}`, entityType, entityId });

      const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
      expect(del.status, await del.text()).toBe(200);

      expect(await photoCount(entityType, entityId)).toBe(1);
    });
  }
});

describe('a post-delete reminder-cleanup throw does NOT fail the vehicle delete', () => {
  test('deactivateVehicleless throwing still returns 200 and the vehicle is deleted', async () => {
    const vehicleId = await seedVehicle(ctx);
    const original = repos().reminders.deactivateVehicleless.bind(repos().reminders);
    repos().reminders.deactivateVehicleless = async () => {
      throw new Error('simulated cleanup hiccup');
    };
    try {
      const del = await ctx.authed('DELETE', `/api/v1/vehicles/${vehicleId}`);
      expect(del.status, await del.text()).toBe(200);
      const n = (
        (await ctx.sql.get('SELECT COUNT(*) AS n FROM vehicles WHERE id = ?', [vehicleId])) as {
          n: number;
        }
      ).n;
      expect(n).toBe(0);
    } finally {
      repos().reminders.deactivateVehicleless = original;
    }
  });
});
