import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../../../test-helpers/http-client';

let ctx: TestApp;
const OTHER_USER = 'other-owner-llm';

type ToolsModule = typeof import('../tools');
let tools: ToolsModule;

const NOW_MS = 1_900_000_000_000;

beforeEach(async () => {
  ctx = await createTestApp();
  tools = await import('../tools');
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

describe('assistant tool layer userId scoping', () => {
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
    expect(summary.expenseCount).toBe(1);
    expect(summary.totalAmount).toBe(50);
  });

  test("a model-supplied vehicleId for another user's vehicle is rejected", async () => {
    seedVehicle('veh-theirs', OTHER_USER);
    await expect(
      tools.ASSISTANT_TOOLS.getExpenseSummary.run(
        { range: 'all', vehicleId: 'veh-theirs' },
        ctx.user.id,
        NOW_MS
      )
    ).rejects.toThrow();
  });

  test("getFuelStats rejects another user's vehicleId", async () => {
    seedVehicle('veh-theirs', OTHER_USER);
    await expect(
      tools.ASSISTANT_TOOLS.getFuelStats.run(
        { range: '30d', vehicleId: 'veh-theirs' },
        ctx.user.id,
        NOW_MS
      )
    ).rejects.toThrow();
  });

  test('a model-supplied vehicleId the session user owns is allowed', async () => {
    seedVehicle('veh-mine', ctx.user.id);
    seedExpense('exp-mine', 'veh-mine', ctx.user.id, 7500);
    const summary = (await tools.ASSISTANT_TOOLS.getExpenseSummary.run(
      { range: 'all', vehicleId: 'veh-mine' },
      ctx.user.id,
      NOW_MS
    )) as { totalAmount: number };
    expect(summary.totalAmount).toBe(75);
  });
});

describe('assistant tool layer arg validation and frozen allowlist', () => {
  test('the range arg is an allow-listed enum — a bad value fails the schema', () => {
    const s = tools.ASSISTANT_TOOLS.getFuelStats.schema;
    expect(s.safeParse({ range: '30d' }).success).toBe(true);
    expect(s.safeParse({ range: 'last-tuesday' }).success).toBe(false);
    expect(s.safeParse({ range: '30d; DROP TABLE expenses' }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false);
  });

  test('every tool is in the frozen allowlist with a schema and a run function', () => {
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
    expect(Object.isFrozen(tools.ASSISTANT_TOOLS)).toBe(true);
  });

  test('toolDefinitions exposes name + description + a bounded JSON-schema for every tool', () => {
    const defs = tools.toolDefinitions();
    expect(defs).toHaveLength(8);
    for (const d of defs) {
      expect(d.name).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.parameters.type).toBe('object');
      expect(d.parameters.additionalProperties).toBe(false);
    }
    const fuel = defs.find((d) => d.name === 'getFuelStats');
    const props = fuel?.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.range.enum).toEqual([...tools.RANGE_VALUES]);
  });
});

describe('resolveRange maps range values to unix-second windows', () => {
  test('maps each enum to a sane unix-seconds window ending at now', () => {
    const end = Math.floor(NOW_MS / 1000);
    expect(tools.resolveRange('all', NOW_MS)).toEqual({ start: 0, end });
    expect(tools.resolveRange('30d', NOW_MS)).toEqual({ start: end - 30 * 86_400, end });
    expect(tools.resolveRange('90d', NOW_MS)).toEqual({ start: end - 90 * 86_400, end });
    const ytd = tools.resolveRange('ytd', NOW_MS);
    expect(ytd.end).toBe(end);
    expect(ytd.start).toBeLessThan(end);
    expect(ytd.start).toBeGreaterThan(0);
  });
});
