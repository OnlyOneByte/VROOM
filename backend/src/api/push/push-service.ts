/**
 * Push send service (push-notifications T4a — the fork-free send + reaping half).
 *
 * `notifyUser(userId, payload)` fans a Web Push notification out to all of a user's subscriptions and
 * runs the reaping lifecycle: a `gone` (404/410) result PRUNES that dead subscription; a
 * `transientError` increments the failure streak and reaps past the configured cap (the #135
 * reaping-hygiene class); an `ok` clears the streak. It is BEST-EFFORT — wrapped so it NEVER throws
 * into its caller and NEVER blocks (R3): the reminder feed is the source of truth, push is an
 * additive nudge, and a push failure must not fail a reminder write.
 *
 * The actual transport is behind a `PushSender` DI seam (the PhotosClient/VLM-adapter pattern): the
 * REAL sender wraps `web-push.sendNotification` (mapping a 404/410 → `gone`, any other failure →
 * `transientError`); a FAKE sender (tests) records calls + scripts results, so the in-memory harness
 * exercises the whole lifecycle ZERO-network with no real VAPID keypair.
 *
 * NOTE (T4a scope): this module is the send + lifecycle ONLY. WHERE/WHEN it fires from the
 * trigger-service (the request-driven hook) is T4b — that placement is the D2 fork, held for the T0
 * ACK. This half is fork-free (a pure sender that any caller can invoke).
 */

import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from 'web-push';
import { CONFIG } from '../../config';
import type { PushSubscription } from '../../db/schema';
import { logger } from '../../utils/logger';
import { isAllowedPushEndpoint } from './push-endpoint';
import { pushSubscriptionRepository } from './repository';

/** The notification payload the SW renders (design §4). NO PII beyond the reminder text the user authored. */
export interface PushPayload {
  title: string;
  body: string;
  /** Collapse-key so repeated nudges for the same reminder replace rather than stack. */
  tag?: string;
  /** Where a click should land (the SW's notificationclick handler opens/focuses this). */
  url?: string;
}

/** The outcome of a single send — drives the reaping lifecycle. */
export type PushResult =
  | { kind: 'ok' }
  | { kind: 'gone' } // 404/410: the browser dropped this subscription → prune it
  | { kind: 'transientError' }; // any other failure → count toward the reap cap

/** The transport seam. The real impl talks to the push service; the fake records + scripts (tests). */
export interface PushSender {
  send(subscription: PushSubscription, payload: PushPayload): Promise<PushResult>;
}

// --- The real web-push-backed sender -----------------------------------------------------------

let vapidConfigured = false;

/** Configure web-push with the VAPID keypair once (idempotent). Only called when CONFIG.push.enabled. */
function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const { vapidSubject, vapidPublicKey, vapidPrivateKey } = CONFIG.push;
  if (!(vapidSubject && vapidPublicKey && vapidPrivateKey)) {
    throw new Error('VAPID keypair is not configured');
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigured = true;
}

/** The real sender: encrypts + POSTs via web-push, mapping the HTTP outcome to a PushResult. */
export const webPushSender: PushSender = {
  async send(subscription, payload) {
    // Defense-in-depth SSRF guard (ARCC): the subscribe route already rejects a non-allowlisted
    // endpoint, but NEVER POST to a rogue host even if a row predates that guard (or arrives by another
    // path) — treat it as permanently gone so the reaping lifecycle prunes it rather than retrying.
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
      // 404/410 = the endpoint is permanently gone (unsubscribed / expired) → prune.
      if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
        return { kind: 'gone' };
      }
      // Anything else (429, 5xx, network) is transient — count it, do not prune on the first miss.
      return { kind: 'transientError' };
    }
  },
};

// --- The DI seam --------------------------------------------------------------------------------

let activeSender: PushSender = webPushSender;

/** Test seam: override the sender (pass null to restore the real web-push one). */
export function setPushSenderForTest(sender: PushSender | null): void {
  activeSender = sender ?? webPushSender;
}

// --- The fan-out + reaping lifecycle ------------------------------------------------------------

type NotifySummary = { sent: number; pruned: number; failed: number };

/**
 * Send to ONE subscription + apply the reaping lifecycle, folding the outcome into `summary`. Split out
 * of notifyUser so the fan-out loop stays simple (keeps each function under the complexity bar) and the
 * per-result branches read as one unit. Never throws — a per-subscription error is caught by the caller.
 */
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
  // transientError: count it; reap a persistently-failing (but not explicitly-gone) endpoint past the
  // cap (#135) so a dead-but-not-410 endpoint does not linger + retry forever.
  const failures = await pushSubscriptionRepository.incrementFailure(sub.id);
  summary.failed += 1;
  if (failures >= CONFIG.validation.push.maxConsecutiveFailures) {
    await pushSubscriptionRepository.prune(sub.id);
    summary.pruned += 1;
  }
}

/**
 * Send `payload` to every subscription `userId` owns, applying the reaping lifecycle per result.
 * BEST-EFFORT: never throws into the caller, never blocks a reminder write. Returns a small summary
 * (useful for tests / logging); callers may ignore it.
 */
export async function notifyUser(userId: string, payload: PushPayload): Promise<NotifySummary> {
  const summary: NotifySummary = { sent: 0, pruned: 0, failed: 0 };
  try {
    // When the REAL transport is active but the server has no VAPID keypair, sending is impossible —
    // skip (the in-app feed is the baseline channel; do NOT touch failureCount on a config gap). An
    // INJECTED sender (tests / a future custom transport) defines its own transport, so it always runs.
    if (activeSender === webPushSender && !CONFIG.push.enabled) return summary;

    const subscriptions = await pushSubscriptionRepository.findByUser(userId);
    for (const sub of subscriptions) {
      try {
        await sendToSubscription(sub, payload, summary);
      } catch (err) {
        // A per-subscription DB/transport error must not abort the whole fan-out.
        summary.failed += 1;
        logger.warn('Push notify: a single subscription failed', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    // The whole notify is best-effort — swallow (log status only, never the payload/keys) so a caller
    // (the trigger-service, T4b) is never disrupted by a push failure.
    logger.warn('Push notifyUser failed (best-effort, swallowed)', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return summary;
}
