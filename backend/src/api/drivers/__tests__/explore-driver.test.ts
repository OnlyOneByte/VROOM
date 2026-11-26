import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'ex-car';

interface Period {
  series: { key: string; label: string; values: Array<number | null> }[];
}

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'ex');
  await ctx.authed('PUT', `/api/v1/vehicles/${CAR}/car-share`, { enabled: true });
  const spend = (request: typeof ctx.authed, amount: number, date: string) =>
    request('POST', '/api/v1/expenses', {
      vehicleId: CAR,
      category: 'maintenance',
      date,
      expenseAmount: amount,
    });
  await spend(ctx.authed, 60, '2024-03-02');
  await spend(m.editor.request, 40, '2024-03-03');
  ctx.sqlite.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('unpaid', ?, ?, 'maintenance', ?, 1500)",
    [CAR, ctx.user.id, Date.parse('2024-03-04') / 1000]
  );
}, 20_000);
afterEach(() => ctx.close());

test('explore splits cost by who paid, with unrecorded payers on their own line', async () => {
  const start = Date.parse('2024-03-01') / 1000;
  const end = Date.parse('2024-03-10') / 1000;
  const qs = `metric=cost&groupBy=driver&interval=none&start=${start}&end=${end}&vehicleIds=${CAR}`;
  const res = await ctx.authed('GET', `/api/v1/analytics/query?${qs}`);
  expect(res.status).toBe(200);
  const body = await json<DataEnvelope<Period>>(res);
  const byLabel = new Map(body.data.series.map((s) => [s.label, s.values[0]]));
  expect(byLabel.get('Test User')).toBe(60);
  expect(byLabel.get('No one recorded')).toBe(15);
  expect([...byLabel.values()].reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(115);
});
