import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'sp-car';
const base = `/api/v1/vehicles/${CAR}/drivers`;
const PERIOD = '?from=2024-03-01T00:00:00.000Z&to=2024-03-31T23:59:59.000Z';
const at = (day: string) => Math.floor(Date.parse(day) / 1000);

interface Balances {
  scope: 'everyone' | 'own';
  rules: unknown;
  drivers: { driverId: string; owed: number; paid: number; balance: number; you: boolean }[];
  transfers: { fromDriverId: string; toDriverId: string; amount: number }[];
  total: number | null;
  unassigned: number | null;
}

let owner = '';
let editor = '';

function trip(id: string, start: number, end: number, driverId: string) {
  ctx.sqlite.run(
    "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, driver_id) VALUES (?, ?, ?, ?, ?, 'personal', ?, ?)",
    [id, CAR, ctx.user.id, start, end, at('2024-03-05'), driverId]
  );
}

function expense(id: string, category: string, cents: number, payer: string, source?: string) {
  ctx.sqlite.run(
    'INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, paid_by_driver_id, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, CAR, ctx.user.id, category, at('2024-03-10'), cents, payer, source ?? null]
  );
}

async function balances(as: { request: TestApp['authed'] } | null = null): Promise<Balances> {
  const res = as
    ? await as.request('GET', `${base}/balances${PERIOD}`)
    : await ctx.authed('GET', `${base}/balances${PERIOD}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Balances>>(res)).data;
}

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'sp');
  await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: true });
  const list = (
    await json<DataEnvelope<{ id: string; userId: string | null }[]>>(await ctx.authed('GET', base))
  ).data;
  owner = list.find((d) => d.userId === ctx.user.id)?.id ?? '';
  editor = list.find((d) => d.userId === m.editor.id)?.id ?? '';
  trip('sp-t1', 1000, 1300, owner);
  trip('sp-t2', 1300, 1400, editor);
  expense('sp-fuel', 'fuel', 8000, owner);
  expense('sp-ins', 'financial', 12000, owner, 'insurance_term');
}, 20_000);
afterEach(() => ctx.close());

describe('split rules and balances', () => {
  test('by default running costs follow distance and ownership costs stay with the payer', async () => {
    const rules = await json<DataEnvelope<unknown>>(await ctx.authed('GET', `${base}/rules`));
    expect(rules.data).toEqual({ running: { kind: 'distance' }, ownership: { kind: 'payer' } });
    const data = await balances();
    expect(data.scope).toBe('everyone');
    expect(data.transfers).toEqual([
      expect.objectContaining({ fromDriverId: editor, toDriverId: owner, amount: 20 }),
    ]);
    expect(data.total).toBe(200);
  });

  test('fixed ownership shares move the premium, and someone who cannot see it does not', async () => {
    const rules = {
      running: { kind: 'distance' },
      ownership: { kind: 'fixed', shares: { [owner]: 50, [editor]: 50 } },
    };
    expect((await ctx.authed('PUT', `${base}/rules`, rules)).status).toBe(200);
    expect((await balances()).transfers).toEqual([
      expect.objectContaining({ fromDriverId: editor, toDriverId: owner, amount: 80 }),
    ]);
    overrideOn(ctx, CAR, m.coOwner, 'vehicle.insurance.read', 'deny');
    expect((await balances(m.coOwner)).transfers).toEqual([
      expect.objectContaining({ fromDriverId: editor, toDriverId: owner, amount: 20 }),
    ]);
  });

  test('a driver without the full view sees only their own balance and transfers', async () => {
    const data = await balances(m.editor);
    expect(data.scope).toBe('own');
    expect(data.drivers.map((d) => d.driverId)).toEqual([editor]);
    expect(data.drivers[0]).toMatchObject({ owed: 20, paid: 0, balance: 20, you: true });
    expect(data.total).toBeNull();
  });

  test("a driver without the full view sees only their own fixed share, not anyone else's", async () => {
    const rules = {
      running: { kind: 'distance' },
      ownership: { kind: 'fixed', shares: { [owner]: 70, [editor]: 30 } },
    };
    await ctx.authed('PUT', `${base}/rules`, rules);
    const own = {
      running: { kind: 'distance' },
      ownership: { kind: 'fixed', shares: { [editor]: 30 } },
    };
    const read = await json<DataEnvelope<unknown>>(await m.editor.request('GET', `${base}/rules`));
    expect(read.data).toEqual(own);
    expect((await balances(m.editor)).rules).toEqual(own);
    const full = await json<DataEnvelope<unknown>>(await ctx.authed('GET', `${base}/rules`));
    expect(full.data).toEqual(rules);
  });

  test('rules are checked: shares add up to 100 and name active drivers of this car', async () => {
    const bad = (shares: Record<string, number>) =>
      ctx.authed('PUT', `${base}/rules`, {
        running: { kind: 'fixed', shares },
        ownership: { kind: 'payer' },
      });
    expect((await bad({ [owner]: 60, [editor]: 30 })).status).toBe(400);
    expect((await bad({ [owner]: 50, 'someone-else': 50 })).status).toBe(400);
    const equalOwnership = { running: { kind: 'distance' }, ownership: { kind: 'equal' } };
    expect((await ctx.authed('PUT', `${base}/rules`, equalOwnership)).status).toBe(400);
    const asEditor = await m.editor.request('PUT', `${base}/rules`, {
      running: { kind: 'equal' },
      ownership: { kind: 'payer' },
    });
    expect(asEditor.status).toBe(403);
  });

  test('rules are not on the vehicle any more, and nothing is there while sharing is off', async () => {
    const vehicle = await json<DataEnvelope<Record<string, unknown>>>(
      await m.viewer.request('GET', `/api/v1/vehicles/${CAR}`)
    );
    expect(vehicle.data).not.toHaveProperty('carShareRules');
    await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: false });
    expect((await ctx.authed('GET', `${base}/rules`)).status).toBe(404);
    expect((await ctx.authed('GET', `${base}/balances${PERIOD}`)).status).toBe(404);
  });

  test('balances need permission to see costs', async () => {
    overrideOn(ctx, CAR, m.editor, 'vehicle.expense.read', 'deny');
    expect((await m.editor.request('GET', `${base}/balances${PERIOD}`)).status).toBe(403);
  });
});
