/**
 * LLM assistant read-tool layer — the SAFETY CORE (llm-assistant T2). These pin the load-bearing
 * guarantees the whole feature rests on (design §4 / §7.4-5, ARCC confused-deputy + GenAI-tool-use):
 *
 *  1. userId-SCOPED execution — a tool invoked with user A's id NEVER returns user B's rows. The userId
 *     comes from the SESSION, never a model arg; there is no parameter by which the model could widen it.
 *  2. confused-deputy guard on a model-supplied vehicleId — calling getExpenseSummary/getFuelStats with
 *     ANOTHER user's vehicleId throws (NotFoundError, existence-hiding) — the model cannot reach a vehicle
 *     the session user cannot read.
 *  3. the `range` arg is an allow-listed ENUM — a bad/free value fails the Zod schema (no injection).
 *  4. the allowlist is a fixed frozen set — every tool is read-only; the model cannot name a tool we did
 *     not pre-specify (the orchestrator looks names up here).
 *
 * createTestApp() rewrites env then the test DYNAMIC-imports the DB-bound tools module AFTER it, so the
 * repos the tools wrap bind the in-memory test DB (the C291/C300 harness pattern).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../../../test-helpers/http-client';

let ctx: TestApp;
const OTHER_USER = 'other-owner-llm';

// Dynamically imported AFTER createTestApp so they bind the test DB singleton.
type ToolsModule = typeof import('../tools');
let tools: ToolsModule;

const NOW_MS = 1_900_000_000_000; // a fixed "now" so resolveRange is deterministic in tests

beforeEach(async () => {
  ctx = await createTestApp();
  tools = await import('../tools');
  // A second user who owns the "foreign" data the session user must never reach through a tool.
  ctx.sqlite.run(
    `INSERT INTO users (id, email, display_name) VALUES (?, 'other-llm@test.com', 'Other Owner')`,
    [OTHER_USER]
  );
});
afterEach(() => ctx.close());

function seedVehicle(id: string, userId: string): void {
  ctx.sqlite.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)`,
    [id, userId]
  );
}
function seedExpense(id: string, vehicleId: string, userId: string, amountCents: number): void {
  ctx.sqlite.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES (?, ?, ?, 'maintenance', 1700000000, ?)`,
    [id, vehicleId, userId, amountCents]
  );
}

describe('assistant tool layer — userId scoping (the confused-deputy core, T2)', () => {
  test('listVehicles returns ONLY the session user vehicles, never another user', async () => {
    seedVehicle('veh-mine', ctx.user.id);
    seedVehicle('veh-theirs', OTHER_USER);

    const mine = (await tools.ASSISTANT_TOOLS.listVehicles.run({}, ctx.user.id, NOW_MS)) as Array<{
      id: string;
    }>;
    const ids = mine.map((v) => v.id);
    expect(ids).toContain('veh-mine');
    expect(ids).not.toContain('veh-theirs');
  });

  test('getExpenseSummary aggregates ONLY the session user expenses', async () => {
    seedVehicle('veh-mine', ctx.user.id);
    seedVehicle('veh-theirs', OTHER_USER);
    seedExpense('exp-mine', 'veh-mine', ctx.user.id, 5000);
    seedExpense('exp-theirs', 'veh-theirs', OTHER_USER, 999999);

    const summary = (await tools.ASSISTANT_TOOLS.getExpenseSummary.run(
      { range: 'all' },
      ctx.user.id,
      NOW_MS
    )) as { totalAmount: number; expenseCount: number };
    // Only the session user's single expense is counted — the other user's huge expense is invisible.
    expect(summary.expenseCount).toBe(1);
    expect(summary.totalAmount).toBe(5000);
  });

  test("a model-supplied vehicleId for ANOTHER user's vehicle is rejected (confused-deputy guard)", async () => {
    seedVehicle('veh-theirs', OTHER_USER);
    // The model asks for a summary scoped to a vehicle the session user does NOT own → NotFoundError.
    await expect(
      tools.ASSISTANT_TOOLS.getExpenseSummary.run(
        { range: 'all', vehicleId: 'veh-theirs' },
        ctx.user.id,
        NOW_MS
      )
    ).rejects.toThrow();
  });

  test("getFuelStats with another user's vehicleId is rejected (confused-deputy guard)", async () => {
    seedVehicle('veh-theirs', OTHER_USER);
    await expect(
      tools.ASSISTANT_TOOLS.getFuelStats.run(
        { range: '30d', vehicleId: 'veh-theirs' },
        ctx.user.id,
        NOW_MS
      )
    ).rejects.toThrow();
  });

  test('the session user CAN scope to their OWN vehicle (the guard allows owned access)', async () => {
    seedVehicle('veh-mine', ctx.user.id);
    seedExpense('exp-mine', 'veh-mine', ctx.user.id, 7500);
    const summary = (await tools.ASSISTANT_TOOLS.getExpenseSummary.run(
      { range: 'all', vehicleId: 'veh-mine' },
      ctx.user.id,
      NOW_MS
    )) as { totalAmount: number };
    expect(summary.totalAmount).toBe(7500);
  });
});

describe('assistant tool layer — arg validation + the frozen allowlist (T2)', () => {
  test('the range arg is an allow-listed enum — a bad value fails the schema', () => {
    const s = tools.ASSISTANT_TOOLS.getFuelStats.schema;
    expect(s.safeParse({ range: '30d' }).success).toBe(true);
    expect(s.safeParse({ range: 'last-tuesday' }).success).toBe(false);
    expect(s.safeParse({ range: '30d; DROP TABLE expenses' }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false); // range is required
  });

  test('every tool is in the frozen allowlist + has a schema + a run fn (read-only, fixed set)', () => {
    const names = Object.keys(tools.ASSISTANT_TOOLS).sort();
    expect(names).toEqual(
      [
        'getAnalyticsSummary',
        'getCrossVehicle',
        'getExpenseSummary',
        'getFinancingState',
        'getFuelStats',
        'getInsuranceState',
        'getUpcomingReminders',
        'listVehicles',
      ].sort()
    );
    for (const t of Object.values(tools.ASSISTANT_TOOLS)) {
      expect(typeof t.run).toBe('function');
      expect(t.schema).toBeDefined();
      expect(typeof t.name).toBe('string');
    }
    // Frozen — the model/caller cannot add a tool to the allowlist at runtime.
    expect(Object.isFrozen(tools.ASSISTANT_TOOLS)).toBe(true);
  });

  test('toolDefinitions exposes name + description + a bounded JSON-schema for every tool', () => {
    const defs = tools.toolDefinitions();
    expect(defs).toHaveLength(8);
    for (const d of defs) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.parameters.type).toBe('object');
      expect(d.parameters.additionalProperties).toBe(false); // the model cannot smuggle extra args
    }
    // A range-bearing tool advertises the allow-listed enum (not a free string).
    const fuel = defs.find((d) => d.name === 'getFuelStats');
    const props = fuel?.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.range.enum).toEqual([...tools.RANGE_VALUES]);
  });
});

describe('resolveRange — the bounded window mapper (T2)', () => {
  test('maps each enum to a sane unix-seconds window ending at now', () => {
    const end = Math.floor(NOW_MS / 1000);
    expect(tools.resolveRange('all', NOW_MS)).toEqual({ start: 0, end });
    expect(tools.resolveRange('30d', NOW_MS)).toEqual({ start: end - 30 * 86_400, end });
    expect(tools.resolveRange('90d', NOW_MS)).toEqual({ start: end - 90 * 86_400, end });
    // ytd starts at Jan 1 of the current year, before now.
    const ytd = tools.resolveRange('ytd', NOW_MS);
    expect(ytd.end).toBe(end);
    expect(ytd.start).toBeLessThan(end);
    expect(ytd.start).toBeGreaterThan(0);
  });
});
