/**
 * notifyUser against the in-memory DB with a fake PushSender. Covers marking success, pruning gone
 * endpoints, counting transient failures and pruning past the cap, fan-out across devices, swallowing
 * sender exceptions, and sending only to the target user. An injected sender runs even when VAPID is
 * not configured.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import {
  notifyUser,
  type PushResult,
  type PushSender,
  setPushSenderForTest,
} from '../push-service';
import { pushSubscriptionRepository } from '../repository';

let ctx: TestApp;
let userA: string;
let userB: string;
let bCounter = 0;

/** A fake sender that returns a scripted result per endpoint (default ok), and records calls. */
function scriptedSender(
  byEndpoint: Record<string, PushResult> = {}
): PushSender & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async send(sub) {
      calls.push(sub.endpoint);
      return byEndpoint[sub.endpoint] ?? { kind: 'ok' };
    },
  };
}

beforeEach(async () => {
  ctx = await createTestApp();
  userA = ctx.user.id;
  const { db } = await import('../../../db/connection');
  const schema = await import('../../../db/schema');
  userB = `push-svc-b-${++bCounter}`;
  await db
    .insert(schema.users)
    .values({ id: userB, email: `svcb-${bCounter}@t.com`, displayName: 'B' });
});

afterEach(() => {
  setPushSenderForTest(null);
  ctx.close();
});

const PAYLOAD = { title: 'Oil change due', body: 'Due now', tag: 'rem-1', url: '/reminders' };

async function sub(userId: string, endpoint: string): Promise<void> {
  await pushSubscriptionRepository.upsertByEndpoint(userId, { endpoint, p256dh: 'k', auth: 'a' });
}

describe('notifyUser lifecycle', () => {
  test('ok → markSuccess, the subscription survives', async () => {
    await sub(userA, 'ep-ok');
    setPushSenderForTest(scriptedSender()); // default ok

    const summary = await notifyUser(userA, PAYLOAD);
    expect(summary).toEqual({ sent: 1, pruned: 0, failed: 0 });

    const rows = await pushSubscriptionRepository.findByUser(userA);
    expect(rows).toHaveLength(1);
    expect(rows[0].failureCount).toBe(0);
    expect(rows[0].lastSuccessAt).toBeInstanceOf(Date);
  });

  test('gone → prune (the 404/410 endpoint is removed)', async () => {
    await sub(userA, 'ep-gone');
    setPushSenderForTest(scriptedSender({ 'ep-gone': { kind: 'gone' } }));

    const summary = await notifyUser(userA, PAYLOAD);
    expect(summary).toEqual({ sent: 0, pruned: 1, failed: 0 });
    expect(await pushSubscriptionRepository.findByUser(userA)).toHaveLength(0);
  });

  test('transientError increments the streak but does NOT prune before the cap', async () => {
    await sub(userA, 'ep-flaky');
    setPushSenderForTest(scriptedSender({ 'ep-flaky': { kind: 'transientError' } }));

    await notifyUser(userA, PAYLOAD);
    const rows = await pushSubscriptionRepository.findByUser(userA);
    expect(rows).toHaveLength(1); // survives the first miss
    expect(rows[0].failureCount).toBe(1);
  });

  test('a persistently-transient endpoint is reaped once the streak hits the cap', async () => {
    await sub(userA, 'ep-dead');
    setPushSenderForTest(scriptedSender({ 'ep-dead': { kind: 'transientError' } }));

    const cap = 5; // Matches CONFIG.validation.push.maxConsecutiveFailures.
    for (let i = 0; i < cap; i++) await notifyUser(userA, PAYLOAD);
    expect(await pushSubscriptionRepository.findByUser(userA)).toHaveLength(0);
  });

  test('fans out over many devices; the summary counts each outcome', async () => {
    await sub(userA, 'ep-ok');
    await sub(userA, 'ep-gone');
    await sub(userA, 'ep-flaky');
    const sender = scriptedSender({
      'ep-gone': { kind: 'gone' },
      'ep-flaky': { kind: 'transientError' },
    });
    setPushSenderForTest(sender);

    const summary = await notifyUser(userA, PAYLOAD);
    expect(sender.calls.sort()).toEqual(['ep-flaky', 'ep-gone', 'ep-ok']);
    expect(summary).toEqual({ sent: 1, pruned: 1, failed: 1 });
  });

  test('best-effort: a sender that THROWS is swallowed + does not abort the fan-out', async () => {
    await sub(userA, 'ep-1');
    await sub(userA, 'ep-2');
    let calls = 0;
    setPushSenderForTest({
      async send() {
        calls += 1;
        throw new Error('boom');
      },
    });

    // Must not reject, and must still try both endpoints.
    const summary = await notifyUser(userA, PAYLOAD);
    expect(calls).toBe(2);
    expect(summary.failed).toBe(2);
    // Both rows survive (a thrown transport error is not a definitive "gone").
    expect(await pushSubscriptionRepository.findByUser(userA)).toHaveLength(2);
  });

  test('scope: only the target user subscriptions are sent to', async () => {
    await sub(userA, 'ep-a');
    await sub(userB, 'ep-b');
    const sender = scriptedSender();
    setPushSenderForTest(sender);

    await notifyUser(userA, PAYLOAD);
    expect(sender.calls).toEqual(['ep-a']); // never ep-b
  });
});
