import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type RequestFn, type TestApp } from '../../../test-helpers/http-client';
import { type Members, overrideOn, seedCar, seedMembers } from '../../../test-helpers/members';
import { ASSISTANT_TOOLS } from '../../providers/domains/llm/tools';

let ctx: TestApp;
let m: Members;
const CAR = 'an-car';
const RANGE = 'startDate=1704067200&endDate=1735689600';

beforeEach(async () => {
  ctx = await createTestApp();
  seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'an');
});
afterEach(() => ctx.close());

const status = (request: RequestFn, path: string) => request('GET', path).then((res) => res.status);

describe('vehicle analytics resolve through can() for every role', () => {
  const fuel = `/api/v1/analytics/fuel-stats?vehicleId=${CAR}&${RANGE}`;
  const expenses = `/api/v1/analytics/vehicle-expenses?vehicleId=${CAR}&${RANGE}`;
  const health = `/api/v1/analytics/vehicle-health?vehicleId=${CAR}`;

  test('members read a shared car; strangers get 404 and disabled accounts 403', async () => {
    for (const request of [ctx.authed, m.coOwner.request, m.editor.request, m.viewer.request]) {
      expect(await status(request, fuel)).toBe(200);
      expect(await status(request, expenses)).toBe(200);
      expect(await status(request, health)).toBe(200);
    }
    expect(await status(m.stranger.request, fuel)).toBe(404);
    expect(await status(m.stranger.request, health)).toBe(404);
    expect(await status(m.disabled.request, fuel)).toBe(403);
  });

  test('a deny on expense read blocks expense analytics but not the vehicle itself', async () => {
    overrideOn(ctx, CAR, m.viewer, 'vehicle.expense.read', 'deny');
    expect(await status(m.viewer.request, fuel)).toBe(403);
    expect(await status(m.viewer.request, expenses)).toBe(403);
    expect(await status(m.viewer.request, health)).toBe(200);
  });

  test('account-wide analytics read the caller’s own account', async () => {
    const summary = `/api/v1/analytics/summary?${RANGE}`;
    expect(await status(ctx.authed, summary)).toBe(200);
    expect(await status(m.stranger.request, summary)).toBe(200);
    expect(await status(m.disabled.request, summary)).toBe(403);
  });
});

describe('the assistant resolves through can()', () => {
  test('disabled accounts cannot chat or scan receipts', async () => {
    const chat = await m.disabled.request('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(chat.status).toBe(403);
    const drafts = await m.disabled.request('GET', '/api/v1/photos/receipt-drafts');
    expect(drafts.status).toBe(403);
  });

  test('vehicle tools follow expense read on the car', async () => {
    const fuelStats = ASSISTANT_TOOLS.getFuelStats;
    const summary = ASSISTANT_TOOLS.getExpenseSummary;
    if (!fuelStats || !summary) throw new Error('assistant tools missing');
    const args = { range: 'all', vehicleId: CAR };
    expect(await fuelStats.run(args, m.viewer.id, Date.now())).toBeTruthy();
    expect(await summary.run(args, m.viewer.id, Date.now())).toBeTruthy();
    overrideOn(ctx, CAR, m.viewer, 'vehicle.expense.read', 'deny');
    await expect(fuelStats.run(args, m.viewer.id, Date.now())).rejects.toThrow();
    await expect(summary.run(args, m.viewer.id, Date.now())).rejects.toThrow();
    await expect(fuelStats.run(args, m.stranger.id, Date.now())).rejects.toThrow();
  });
});
