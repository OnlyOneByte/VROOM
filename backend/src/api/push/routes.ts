/**
 * Web Push routes, mounted at `/api/v1/push`. The private VAPID key never leaves the server. When push
 * is disabled, the vapid key route answers 503 PUSH_NOT_CONFIGURED so the client can fall back to the
 * in-app feed. Subscriptions are always scoped to the session user.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { createErrorResponse, ValidationError } from '../../errors';
import { requireAuth } from '../../middleware';
import { zValidator } from '../../utils/validation';
import { isAllowedPushEndpoint } from './push-endpoint';
import { pushSubscriptionRepository } from './repository';

const routes = new Hono();

routes.use('*', requireAuth);

// Bounds keep an oversized body from bloating the stored row or the later web-push call.
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

routes.get('/vapid-public-key', (c) => {
  if (!CONFIG.push.enabled) {
    return c.json(
      createErrorResponse(
        'PUSH_NOT_CONFIGURED',
        'Push notifications are not configured on this server.'
      ),
      503
    );
  }
  // Only the public key is returned; the private key is never sent to clients.
  return c.json({ success: true, data: { publicKey: CONFIG.push.vapidPublicKey } });
});

routes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  // The server will later POST to this URL, so reject anything off the push-vendor allowlist first.
  if (!isAllowedPushEndpoint(body.endpoint)) {
    throw new ValidationError('Unsupported push endpoint.');
  }
  const stored = await pushSubscriptionRepository.upsertByEndpoint(user.id, {
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: body.userAgent ?? null,
  });
  // The keys are not echoed back; the client already holds them.
  return c.json({ success: true, data: { id: stored.id } }, 201);
});

/** Removes the session user's own subscription. An unknown endpoint is a no-op. */
routes.delete('/subscribe', zValidator('json', unsubscribeSchema), async (c) => {
  const user = c.get('user');
  const { endpoint } = c.req.valid('json');
  const removed = await pushSubscriptionRepository.deleteByEndpoint(user.id, endpoint);
  return c.json({ success: true, data: { removed } });
});

export { routes };
