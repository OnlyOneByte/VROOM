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
 * (T3 adds POST/DELETE /subscribe on this same router; the send hook + SW handler are T4/T6.)
 */

import { Hono } from 'hono';
import { CONFIG } from '../../config';
import { requireAuth } from '../../middleware';

const routes = new Hono();

routes.use('*', requireAuth);

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

export { routes };
