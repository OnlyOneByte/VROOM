import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { overrideOn, seedCar, shareCar } from '../../../test-helpers/members';

let ctx: TestApp;
let viewer: Invitee;
let stranger: Invitee;

const SHARED = 'qs-shared';
const PRIVATE = 'qs-private';
const RANGE = 'start=1704067200&end=1735689600';
const JUNE = 1717200000;

interface Period {
  series: Array<{ key: string; values: Array<number | null> }>;
  totals: { value: number | null };
}

interface Items {
  total: number;
  count: number;
  items: Array<{ vehicleId: string; category: string; amount: number }>;
}

function expense(
  vehicleId: string,
  category: string,
  cents: number,
  sourceType: string | null = null
): void {
  ctx.sqlite.run(
    'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      `qs-${vehicleId}-${category}-${cents}`,
      vehicleId,
      ctx.user.id,
      category,
      cents,
      JUNE,
      sourceType,
    ]
  );
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, SHARED);
  await seedCar(ctx, PRIVATE);
  expense(SHARED, 'maintenance', 8000);
  expense(SHARED, 'financial', 40000, 'financing');
  expense(SHARED, 'financial', 120000, 'insurance_term');
  expense(SHARED, 'financial', 5000);
  expense(PRIVATE, 'maintenance', 70000);
  viewer = await createInvitee(ctx, 'qs-viewer');
  stranger = await createInvitee(ctx, 'qs-stranger');
  await shareCar(ctx, SHARED, viewer, 'viewer');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function query(request: RequestFn, params: string): Promise<Period> {
  const res = await request('GET', `/api/v1/analytics/query?metric=cost&${RANGE}&${params}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Period>>(res)).data;
}

async function items(request: RequestFn, params: string): Promise<Items> {
  const res = await request('GET', `/api/v1/analytics/query/items?${RANGE}&${params}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<Items>>(res)).data;
}

const ALL_BY_CATEGORY = 'include=all&interval=none&groupBy=category';

describe('analytics query for a car shared with the viewer', () => {
  test('a viewer without financial access sees the running costs and no financial rows', async () => {
    for (const scope of ['', `vehicleIds=${SHARED}`]) {
      const result = await query(viewer.request, `${ALL_BY_CATEGORY}&${scope}`);
      expect(result.totals.value, scope).toBe(80);
      expect(
        result.series.map((s) => s.key),
        scope
      ).toEqual(['maintenance']);

      const listed = await items(viewer.request, `include=all&${scope}`);
      expect(listed.total, scope).toBe(80);
      expect(listed.count, scope).toBe(1);
      expect(
        listed.items.map((i) => i.category),
        scope
      ).toEqual(['maintenance']);
    }
  });

  test('access to only one kind of financial record still hides them all', async () => {
    await overrideOn(ctx, SHARED, viewer, 'vehicle.financing.read', 'allow');

    const result = await query(viewer.request, ALL_BY_CATEGORY);
    expect(result.totals.value).toBe(80);
    expect((await items(viewer.request, 'include=all')).total).toBe(80);
  });

  test('a viewer the owner lets see financials gets the financial rows too', async () => {
    await overrideOn(ctx, SHARED, viewer, 'vehicle.financing.read', 'allow');
    await overrideOn(ctx, SHARED, viewer, 'vehicle.insurance.read', 'allow');

    const result = await query(viewer.request, ALL_BY_CATEGORY);
    expect(result.totals.value).toBe(80 + 400 + 1200 + 50);
    expect((await items(viewer.request, 'include=all')).total).toBe(80 + 400 + 1200 + 50);
  });

  test("the owner's car that is not shared never reaches the viewer, even when asked for by id", async () => {
    const all = await query(viewer.request, 'interval=none&groupBy=vehicle');
    expect(all.series.map((s) => s.key)).toEqual([SHARED]);

    for (const ids of [PRIVATE, `${SHARED},${PRIVATE}`]) {
      const result = await query(viewer.request, `interval=none&groupBy=vehicle&vehicleIds=${ids}`);
      expect(
        result.series.map((s) => s.key),
        ids
      ).not.toContain(PRIVATE);
      const listed = await items(viewer.request, `vehicleIds=${ids}`);
      expect(
        listed.items.map((i) => i.vehicleId),
        ids
      ).not.toContain(PRIVATE);
    }
    expect((await query(viewer.request, `interval=none&vehicleIds=${PRIVATE}`)).totals.value).toBe(
      0
    );
  });

  test('someone the car is not shared with gets nothing for it', async () => {
    for (const scope of ['', `vehicleIds=${SHARED}`, `vehicleIds=${SHARED},${PRIVATE}`]) {
      expect((await query(stranger.request, `interval=none&${scope}`)).totals.value, scope).toBe(0);
      expect((await items(stranger.request, scope)).count, scope).toBe(0);
    }
  });

  test('a share that is not accepted yet gives nothing', async () => {
    ctx.sqlite.run("UPDATE vehicle_shares SET status = 'pending' WHERE shared_with_id = ?", [
      viewer.id,
    ]);
    expect((await query(viewer.request, `interval=none&vehicleIds=${SHARED}`)).totals.value).toBe(
      0
    );
  });

  test("a shared car kept in another currency is left out rather than summed with the viewer's", async () => {
    ctx.sqlite.run(
      "INSERT INTO user_preferences (user_id, currency_unit) VALUES (?, 'EUR') ON CONFLICT(user_id) DO UPDATE SET currency_unit = 'EUR'",
      [ctx.user.id]
    );
    expect((await query(viewer.request, `interval=none&vehicleIds=${SHARED}`)).totals.value).toBe(
      0
    );
  });

  test("service markers cover the shared car and never the owner's other car", async () => {
    const res = await viewer.request(
      'GET',
      `/api/v1/analytics/query?metric=cost&${RANGE}&annotations=services`
    );
    const body = await json<DataEnvelope<{ annotations: Array<{ vehicleId: string }> }>>(res);
    expect(res.status).toBe(200);
    expect(body.data.annotations.map((a) => a.vehicleId)).toEqual([SHARED]);

    const none = await stranger.request(
      'GET',
      `/api/v1/analytics/query?metric=cost&${RANGE}&annotations=services&vehicleIds=${SHARED}`
    );
    expect((await json<DataEnvelope<{ annotations: unknown[] }>>(none)).data.annotations).toEqual(
      []
    );
  });

  test('the owner still sees every row of both cars', async () => {
    const result = await query(ctx.authed, 'include=all&interval=none');
    expect(result.totals.value).toBe(80 + 400 + 1200 + 50 + 700);
  });
});

describe('analytics query follows the per-car permissions of a share', () => {
  test('a viewer denied expense reads on the shared car gets nothing for it', async () => {
    await overrideOn(ctx, SHARED, viewer, 'vehicle.expense.read', 'deny');
    for (const scope of ['', `vehicleIds=${SHARED}`]) {
      expect((await query(viewer.request, `interval=none&${scope}`)).totals.value, scope).toBe(0);
      expect((await items(viewer.request, scope)).count, scope).toBe(0);
    }
  });

  test('a viewer denied trip reads gets the costs but no trips', async () => {
    ctx.sqlite.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date) VALUES ('qs-trip', ?, ?, 100, 200, 'personal', ?)",
      [SHARED, ctx.user.id, JUNE]
    );
    const trips = async () => {
      const res = await viewer.request(
        'GET',
        `/api/v1/analytics/query?metric=cost&${RANGE}&interval=none&annotations=trips`
      );
      return (await json<DataEnvelope<{ trips: { count: number[] } }>>(res)).data.trips.count;
    };
    expect(await trips()).toEqual([1]);

    await overrideOn(ctx, SHARED, viewer, 'vehicle.trip.read', 'deny');
    expect(await trips()).toEqual([0]);
    expect((await query(viewer.request, 'interval=none')).totals.value).toBe(80);
  });

  test('a viewer who may not see drivers gets the costs without who paid them', async () => {
    ctx.sqlite.run(
      "INSERT INTO vehicle_drivers (id, vehicle_id, user_id, name) VALUES ('qs-driver', ?, NULL, 'Alice')",
      [SHARED]
    );
    ctx.sqlite.run('UPDATE expenses SET paid_by_driver_id = ? WHERE vehicle_id = ?', [
      'qs-driver',
      SHARED,
    ]);

    const seen = await query(viewer.request, 'interval=none&groupBy=driver');
    expect(seen.series.map((s) => s.key)).toEqual(['']);
    expect(JSON.stringify(seen)).not.toContain('Alice');
    expect((await items(viewer.request, 'groupBy=driver&keys=%5B%22qs-driver%22%5D')).count).toBe(
      0
    );

    const own = await query(ctx.authed, `interval=none&groupBy=driver&vehicleIds=${SHARED}`);
    expect(own.series.map((s) => s.key)).toEqual(['qs-driver']);
  });

  test('an editor share reads the shared car the same way', async () => {
    const editor = await createInvitee(ctx, 'qs-editor');
    await shareCar(ctx, SHARED, editor, 'editor');
    expect((await query(editor.request, `${ALL_BY_CATEGORY}`)).totals.value).toBe(80);
  });

  test('hidden financial rows do not move counts or the start of the range', async () => {
    ctx.sqlite.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['qs-early-loan', SHARED, ctx.user.id, 'financial', 9900, 1609459200, 'financing']
    );
    const res = await viewer.request(
      'GET',
      `/api/v1/analytics/query?metric=count&include=all&interval=none&vehicleIds=${SHARED}&end=1735689600`
    );
    const data = (await json<DataEnvelope<Period & { range: { start: number } }>>(res)).data;
    expect(data.totals.value).toBe(1);
    expect(data.range.start).toBe(JUNE);
  });
});

interface Coverage {
  vehicleIds: string[];
  otherCurrency: Array<{ vehicleId: string; currency: string }>;
  unavailable: number;
}

describe('the query and its items report the cars they covered', () => {
  const OWN = 'qs-viewer-car';

  async function coverage(
    request: RequestFn,
    params = '',
    neverNamed: string[] = [PRIVATE]
  ): Promise<Coverage[]> {
    const bodies: Coverage[] = [];
    for (const path of ['query?metric=cost&', 'query/items?']) {
      const res = await request('GET', `/api/v1/analytics/${path}${RANGE}&${params}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      for (const id of neverNamed) expect(text, `${path} names ${id}`).not.toContain(id);
      bodies.push((JSON.parse(text) as DataEnvelope<{ coverage: Coverage }>).data.coverage);
    }
    return bodies;
  }

  const sorted = (c: Coverage) => ({ ...c, vehicleIds: [...c.vehicleIds].sort() });

  function ownerCurrency(currency: string): void {
    ctx.sqlite.run(
      'INSERT INTO user_preferences (user_id, currency_unit) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET currency_unit = excluded.currency_unit',
      [ctx.user.id, currency]
    );
  }

  beforeEach(async () => {
    await seedCar(ctx, OWN, viewer.id);
  });

  test('an owned car and a shared car are both listed, with nothing left out', async () => {
    for (const body of await coverage(viewer.request)) {
      expect(sorted(body)).toEqual({
        vehicleIds: [OWN, SHARED].sort(),
        otherCurrency: [],
        unavailable: 0,
      });
    }
  });

  test('a shared car in another currency is named as left out for its currency', async () => {
    ownerCurrency('EUR');
    for (const body of await coverage(viewer.request)) {
      expect(body).toEqual({
        vehicleIds: [OWN],
        otherCurrency: [{ vehicleId: SHARED, currency: 'EUR' }],
        unavailable: 0,
      });
    }
  });

  test('a shared car without expense access is never named, whatever the currency', async () => {
    await overrideOn(ctx, SHARED, viewer, 'vehicle.expense.read', 'deny');
    for (const currency of ['USD', 'EUR']) {
      ownerCurrency(currency);
      for (const body of await coverage(viewer.request, '', [PRIVATE, SHARED])) {
        expect(body, currency).toEqual({ vehicleIds: [OWN], otherCurrency: [], unavailable: 0 });
      }
      const asked = await coverage(viewer.request, `vehicleIds=${SHARED},${OWN}`, [
        PRIVATE,
        SHARED,
      ]);
      for (const body of asked) {
        expect(body, currency).toEqual({ vehicleIds: [OWN], otherCurrency: [], unavailable: 1 });
      }
    }
  });

  test('a car the viewer cannot read is only counted, never named, when asked for by id', async () => {
    for (const body of await coverage(viewer.request, `vehicleIds=${SHARED},${PRIVATE}`)) {
      expect(body).toEqual({ vehicleIds: [SHARED], otherCurrency: [], unavailable: 1 });
    }
    const strangers = await coverage(stranger.request, `vehicleIds=${SHARED},${PRIVATE}`, [
      PRIVATE,
      SHARED,
    ]);
    for (const body of strangers) {
      expect(body).toEqual({ vehicleIds: [], otherCurrency: [], unavailable: 2 });
    }
  });

  test('the owner sees both of their cars covered', async () => {
    for (const body of await coverage(ctx.authed, '', [])) {
      expect(sorted(body)).toEqual({
        vehicleIds: [PRIVATE, SHARED].sort(),
        otherCurrency: [],
        unavailable: 0,
      });
    }
  });
});
