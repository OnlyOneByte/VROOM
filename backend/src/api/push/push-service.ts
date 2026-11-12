import {
  sendNotification,
  setVapidDetails,
  WebPushError,
  type PushSubscription as WebPushSubscription,
} from 'web-push';
import { CONFIG } from '../../config';
import type { PushSubscription } from '../../db/schema';
import { logger } from '../../utils/logger';
import { isAllowedPushEndpoint } from './push-endpoint';
import { pushSubscriptionRepository } from './repository';

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export type PushResult = { kind: 'ok' } | { kind: 'gone' } | { kind: 'transientError' };

export interface PushSender {
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}

let vapidConfigured = false;

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const { vapidSubject, vapidPublicKey, vapidPrivateKey } = CONFIG.push;
  if (!(vapidSubject && vapidPublicKey && vapidPrivateKey)) {
    throw new Error('VAPID keypair is not configured');
  }
  setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigured = true;
}

export const webPushSender: PushSender = {
  async send(subscription, payload) {
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
      await sendNotification(target, JSON.stringify(payload));
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

export function setPushSenderForTest(sender: PushSender | null): void {
  activeSender = sender ?? webPushSender;
}

type NotifySummary = { sent: number; pruned: number; failed: number };

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
  const failures = await pushSubscriptionRepository.incrementFailure(sub.id);
  summary.failed += 1;
  if (failures >= CONFIG.validation.push.maxConsecutiveFailures) {
    await pushSubscriptionRepository.prune(sub.id);
    summary.pruned += 1;
  }
}

export async function notifyUser(userId: string, payload: PushPayload): Promise<NotifySummary> {
  const summary: NotifySummary = { sent: 0, pruned: 0, failed: 0 };
  try {
    if (activeSender === webPushSender && !CONFIG.push.enabled) return summary;

    const subscriptions = await pushSubscriptionRepository.findByUser(userId);
    for (const sub of subscriptions) {
      try {
        await sendToSubscription(sub, payload, summary);
      } catch (err) {
        summary.failed += 1;
        logger.warn('Push notify: a single subscription failed', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    // Log the error message only: payloads and keys must never reach logs.
    logger.warn('Push notifyUser failed (best-effort, swallowed)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return summary;
}
