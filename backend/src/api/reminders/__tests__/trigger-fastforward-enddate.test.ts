/**
 * Bug #12 (C21 audit, fixed C25): fastForwardPastNow ignored endDate.
 *
 * The main catch-up loop deactivates a bounded reminder once nextDue crosses endDate. But a
 * reminder lapsed past maxCatchUpOccurrences (12) reaches fastForwardPastNow INSTEAD — which (before
 * the fix) advanced nextDue past now with no endDate check and no deactivate, leaving a bounded
 * reminder "active" but permanently dormant (never fires, never closes).
 *
 * This pins the fix: a weekly reminder starting far in the past, with an endDate that lands AFTER
 * the 12-occurrence catch-up window (so the main loop's endDate check never fires — only
 * fastForward reaches it), must end up DEACTIVATED after a trigger, not active-and-fast-forwarded.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Mazda',
    model: '3',
    year: 2019,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

function reminderRow(id: string): { is_active: number } {
  return ctx.sqlite.query('SELECT is_active FROM reminders WHERE id = ?').get(id) as {
    is_active: number;
  };
}

describe('fastForwardPastNow honors endDate (bug #12)', () => {
  test('a lapsed bounded reminder past the catch-up cap is deactivated, not left active', async () => {
    const vehicleId = await seedVehicle();

    // Weekly, starting 2024-01-01. maxCatchUp = 12 → the main loop processes ~12 weekly
    // occurrences (through ~2024-03-25) then hits the cap and hands off to fastForwardPastNow.
    // endDate = 2024-06-01 is AFTER that window but still far in the past relative to now, so:
    //   - the main loop never sees nextDue > endDate (it stops at the 12-occurrence cap first), and
    //   - fastForward, stepping weekly from ~Mar 25 toward now (2026+), crosses endDate — and with
    //     the fix must deactivate there instead of advancing past now and staying active.
    const createRes = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Bounded weekly checkup',
      type: 'notification',
      frequency: 'weekly',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-06-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const created = await json<DataEnvelope<{ reminder: { id: string } }>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    const reminderId = created.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // The reminder is bounded and fully lapsed → it must be deactivated, not active-and-dormant.
    expect(reminderRow(reminderId).is_active).toBe(0);
  });

  // Bug #107 (C362 audit): the in-loop endDate check only inspects values <= now (the while guard).
  // The FINAL advance steps nextDue PAST now and exits the loop, so that last value is never tested
  // against endDate. A bounded reminder whose endDate falls in the period STRADDLING now (after the
  // last <=now step, before the first >now step) was written forward of its endDate yet left active
  // → it would fire again next trigger. Construction: endDate ≈ now lands by definition inside that
  // straddling period AND is >= the last <=now step, so the in-loop guard never catches it — only
  // the after-loop guard does. Monthly from far past → blows past the 12-occurrence cap into
  // fastForwardPastNow. Pre-fix this stays active (is_active=1); the fix deactivates it.
  test('a bounded reminder whose endDate lands in the period straddling now is deactivated, not advanced past it', async () => {
    const vehicleId = await seedVehicle();

    // endDate one second before the server's `now`: it sits inside the final monthly period (which
    // contains now) and at/after the last <=now monthly step (a monthly grid won't land in the last
    // second), so the in-loop `nextDue > endDate` check never fires — exercising ONLY the exit guard.
    const endDate = new Date(Date.now() - 1000).toISOString();

    const createRes = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Bounded monthly checkup ending ~now',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate,
      vehicleIds: [vehicleId],
    });
    const created = await json<DataEnvelope<{ reminder: { id: string } }>>(createRes);
    expect(createRes.status, JSON.stringify(created)).toBe(201);
    const reminderId = created.data.reminder.id;

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);

    // Past its endDate and fully lapsed → must be deactivated, not left active with a future nextDue.
    expect(reminderRow(reminderId).is_active).toBe(0);
  });
});
