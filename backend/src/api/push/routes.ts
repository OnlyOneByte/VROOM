/**
 * Push notification routes (push-notifications) — mounted at `/api/v1/push`.
 *
 * T2 ships the read side: `GET /vapid-public-key` hands the browser the app-wide VAPID PUBLIC key
 * (the applicationServerKey the Push API's pushManager.subscribe() requires). The public key is
 * public-by-design; the PRIVATE key never leaves the server (it lives only in CONFIG.push and is used
 * server-side to sign push payloads — no route ever returns it).
 *
 * When the server has no VAPID keypair configured (CONFIG.push.enabled=false) the feature is OFF: the
 * route answers 503 PUSH_NOT_CONFIGURED so the FE can HONESTLY report "push is not configured on this
 * server" and degrade to the in-app reminder feed (R6) — never a blank/opaque failure.
 *
 * T3 adds POST/DELETE /subscribe (the store side): a browser persists / removes its Web Push
 * subscription. Every write is scoped to the SESSION user (ctx.userId, NEVER a body-supplied id — the
 * endpoint is not a capability, the IDOR discipline). The send hook + SW handler are T4/T6.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { ValidationError } from '../../errors';
import { requireAuth } from '../../middleware';
import { isAllowedPushEndpoint } from './push-endpoint';
import { pushSubscriptionRepository } from './repository';

const routes = new Hono();

routes.use('*', requireAuth);

// SAX-04 input caps — a push endpoint URL + the two base64url client keys are all bounded so a
// malformed/oversized body cannot bloat the row or the later web-push call. Generous but finite.
const MAX_ENDPOINT_CHARS = 2000;
const MAX_KEY_CHARS = 512;
const MAX_USER_AGENT_CHARS = 512;

const subscribeSchema = z.object({
  endpoint: z.string().min(1, 'endpoint is required').max(MAX_ENDPOINT_CHARS),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh is required').max(MAX_KEY_CHARS),
    auth: z.string().min(1, 'keys.auth is required').max(MAX_KEY_CHARS),
  }),
  userAgent: z.string().max(MAX_USER_AGENT_CHARS).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1, 'endpoint is required').max(MAX_ENDPOINT_CHARS),
});

/**
 * GET /api/v1/push/vapid-public-key — the app-wide VAPID public key for pushManager.subscribe().
 * 200 `{ publicKey }` when push is configured; 503 `PUSH_NOT_CONFIGURED` when it is not (feature OFF).
 */
routes.get('/vapid-public-key', (c) => {
  if (!CONFIG.push.enabled) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PUSH_NOT_CONFIGURED',
          message: 'Push notifications are not configured on this server.',
        },
      },
      503
    );
  }
  // Only the PUBLIC key crosses the wire — the private key stays server-side (T4 signs with it).
  return c.json({ success: true, data: { publicKey: CONFIG.push.vapidPublicKey } });
});

/**
 * POST /api/v1/push/subscribe — persist this browser's Web Push subscription for the SESSION user.
 * Idempotent on (userId, endpoint): a re-subscribe from the same browser updates the stored keys +
 * resets the failure streak rather than inserting a duplicate (the device is alive again). The userId
 * is ALWAYS ctx.userId — never taken from the body (a subscription is not a cross-user capability).
 * Body: { endpoint, keys: { p256dh, auth }, userAgent? }.
 */
routes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  // SSRF guard (ARCC SSRF-mitigation): the endpoint is a URL the server will later POST to, so reject
  // anything but an https URL on a known browser-vendor push host BEFORE storing it — no
  // metadata/localhost/private-IP/other-scheme/userinfo endpoint ever enters the DB (SAX-04: filter at
  // the earliest point). A real browser only ever produces such an endpoint; a hand-crafted one is the
  // attack. 422 (unprocessable) — the request is well-formed JSON but the endpoint is not acceptable.
  if (!isAllowedPushEndpoint(body.endpoint)) {
    throw new ValidationError('Unsupported push endpoint.');
  }
  const stored = await pushSubscriptionRepository.upsertByEndpoint(user.id, {
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: body.userAgent ?? null,
  });
  // Do NOT echo the stored crypto keys back — the client already holds them; return only the id.
  return c.json({ success: true, data: { id: stored.id } }, 201);
});

/**
 * DELETE /api/v1/push/subscribe — remove this browser's subscription (the unsubscribe path).
 * Scoped to the session user: the endpoint alone does not authorize — a user can only delete their
 * OWN subscription. Idempotent (deleting an unknown/foreign endpoint is a clean no-op, not an error).
 * Body: { endpoint }.
 */
routes.delete('/subscribe', zValidator('json', unsubscribeSchema), async (c) => {
  const user = c.get('user');
  const { endpoint } = c.req.valid('json');
  const removed = await pushSubscriptionRepository.deleteByEndpoint(user.id, endpoint);
  return c.json({ success: true, data: { removed } });
});

export { routes };
