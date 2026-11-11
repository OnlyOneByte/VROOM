/**
 * Sends Web Push notifications to a user's subscriptions and prunes dead ones. Best-effort: callers
 * never see an exception, because the reminder feed is the source of truth and push is only a nudge.
 */

import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from 'web-push';
import { CONFIG } from '../../config';
import type { PushSubscription } from '../../db/schema';
import { logger } from '../../utils/logger';
import { isAllowedPushEndpoint } from './push-endpoint';
import { pushSubscriptionRepository } from './repository';

/** Rendered by the service worker. Contains no PII beyond the reminder text. */
export interface PushPayload {
  title: string;
  body: string;
  /** Collapse key, so repeated nudges for one reminder replace each other. */
  tag?: string;
  url?: string;
}

export type PushResult = { kind: 'ok' } | { kind: 'gone' } | { kind: 'transientError' };

export interface PushSender {
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}

let vapidConfigured = false;

/** Configures web-push once from CONFIG.push. Requires push to be enabled. */
function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const { vapidSubject, vapidPublicKey, vapidPrivateKey } = CONFIG.push;
  if (!(vapidSubject && vapidPublicKey && vapidPrivateKey)) {
    throw new Error('VAPID keypair is not configured');
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigured = true;
}

export const webPushSender: PushSender = {
  async send(subscription, payload) {
    // Rows stored before the subscribe-time check may not pass it. Treat them as gone so they are pruned.
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      logger.warn('Push send: refusing a non-allowlisted endpoint host (SSRF guard)', {
        subscriptionId: subscription.id,
      });
      return { kind: 'gone' };
    }
    ensureVapidConfigured();
    const target: WebPushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    try {
      await webpush.sendNotification(target, JSON.stringify(payload));
      return { kind: 'ok' };
    } catch (err) {
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        return { kind: 'gone' };
      }
      return { kind: 'transientError' };
    }
  },
};

let activeSender: PushSender = webPushSender;

/** Test seam: pass null to restore the real sender. */
export function setPushSenderForTest(sender: PushSender | null): void {
  activeSender = sender ?? webPushSender;
}

type NotifySummary = { sent: number; pruned: number; failed: number };

/** Applies one send's outcome to the subscription row and the summary. */
async function sendToSubscription(
  sub: PushSubscription,
  payload: PushPayload,
  summary: NotifySummary
): Promise<void> {
  const result = await activeSender.send(sub, payload);
  if (result.kind === 'ok') {
    await pushSubscriptionRepository.markSuccess(sub.id);
    summary.sent += 1;
    return;
  }
  if (result.kind === 'gone') {
    await pushSubscriptionRepository.prune(sub.id);
    summary.pruned += 1;
    return;
  }
  // Endpoints that fail without a 404/410 are pruned once they reach the cap, so they do not retry forever.
  const failures = await pushSubscriptionRepository.incrementFailure(sub.id);
  summary.failed += 1;
  if (failures >= CONFIG.validation.push.maxConsecutiveFailures) {
    await pushSubscriptionRepository.prune(sub.id);
    summary.pruned += 1;
  }
}

/** Best-effort: never throws into the caller. Returns a summary of the outcomes. */
export async function notifyUser(userId: string, payload: PushPayload): Promise<NotifySummary> {
  const summary: NotifySummary = { sent: 0, pruned: 0, failed: 0 };
  try {
    // Without a VAPID keypair the real transport cannot send. Skip without touching failure counts.
    // Injected senders always run.
    if (activeSender === webPushSender && !CONFIG.push.enabled) return summary;

    const subscriptions = await pushSubscriptionRepository.findByUser(userId);
    for (const sub of subscriptions) {
      try {
        await sendToSubscription(sub, payload, summary);
      } catch (err) {
        // One failing subscription must not abort the fan-out.
        summary.failed += 1;
        logger.warn('Push notify: a single subscription failed', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    // Logs the error message only, never the payload or keys.
    logger.warn('Push notifyUser failed (best-effort, swallowed)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return summary;
}
