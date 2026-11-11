// Builds the Hono app with no side effects. index.ts adds the runtime concerns, and tests drive app.request().

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { routes as analyticsRoutes } from './api/analytics/routes';
import { routes as assistantRoutes } from './api/assistant/routes';
import { routes as authRoutes } from './api/auth/routes';
import { routes as expenseRoutes } from './api/expenses/routes';
import { routes as financingRoutes } from './api/financing/routes';
import { routes as insuranceRoutes } from './api/insurance/routes';
import { routes as odometerRoutes } from './api/odometer/routes';
import { routes as photoReceiptDraftRoutes } from './api/photos/receipt-drafts-route';
import { routes as photoRoutes } from './api/photos/routes';
import { routes as providerRoutes } from './api/providers/routes';
import { routes as receiptRoutes } from './api/providers/vlm-routes';
import { routes as pushRoutes } from './api/push/routes';
import { routes as reminderRoutes } from './api/reminders/routes';
import { routes as settingsRoutes } from './api/settings/routes';
import { routes as shareRoutes } from './api/shares/routes';
import { routes as syncRoutes } from './api/sync/routes';
import { routes as tripRoutes } from './api/trips/routes';
import { routes as vehicleRoutes } from './api/vehicles/routes';
import { CONFIG } from './config';
import { createErrorResponse } from './errors';
import { activityTracker, bodyLimit, errorHandler, optionalAuth, rateLimiter } from './middleware';
import { getClientIp } from './utils/client-ip';
import { logger } from './utils/logger';

const app = new Hono();

app.onError(errorHandler);

export const GLOBAL_MAX_BODY_SIZE = 10 * 1024 * 1024;

// Paths whose bodies may exceed the global cap. A route-level bodyLimit can only tighten the global
// check, which runs first, so these paths are exempted here. The unversioned alias is listed because its
// 308 redirect would otherwise reject a large upload before it reached the real route.
const LARGER_BODY_LIMITS: Record<string, number> = {
  '/api/v1/sync/restore/from-backup': CONFIG.backup.maxFileSize,
  '/api/sync/restore/from-backup': CONFIG.backup.maxFileSize,
};

const globalBodyLimit = bodyLimit({
  maxSize: GLOBAL_MAX_BODY_SIZE,
  message: 'Request body too large',
});
const largerBodyLimits = new Map(
  Object.entries(LARGER_BODY_LIMITS).map(([path, maxSize]) => [
    path,
    bodyLimit({ maxSize, message: 'Request body too large' }),
  ])
);

app.use('*', (c, next) => (largerBodyLimits.get(c.req.path) ?? globalBodyLimit)(c, next));

// Widen these directives when a feature needs an external image, API, or font origin.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
    crossOriginResourcePolicy: 'cross-origin',
  })
);

const globalRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.global,
  keyGenerator: (c) => {
    // Anonymous requests key by the trusted client IP. The raw X-Forwarded-For header is spoofable.
    const user = c.get('user');
    return `global:${user?.id || getClientIp(c)}`;
  },
});

// Runs before the rate limiter so the limiter can key by user. Scoped to /api/* to skip DB lookups elsewhere.
app.use('/api/*', optionalAuth);

app.use('*', globalRateLimiter);

app.use(
  '*',
  cors({
    origin: CONFIG.cors.origins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
);

app.use(
  '*',
  csrf({
    origin: CONFIG.cors.origins,
  })
);

app.use('*', honoLogger());

if (CONFIG.env === 'development') {
  app.use('*', prettyJSON());
}

app.use('*', activityTracker);

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: CONFIG.version,
  });
});

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/vehicles', vehicleRoutes);
app.route('/api/v1/financing', financingRoutes);
app.route('/api/v1/expenses', expenseRoutes);
app.route('/api/v1/insurance', insuranceRoutes);
app.route('/api/v1/odometer', odometerRoutes);
// Must precede the generic photo routes, or /:entityType/:entityId matches /receipt-drafts first.
app.route('/api/v1/photos', photoReceiptDraftRoutes);
app.route('/api/v1/photos', photoRoutes);
app.route('/api/v1/providers', providerRoutes);
app.route('/api/v1/receipts', receiptRoutes);
app.route('/api/v1/assistant', assistantRoutes);
app.route('/api/v1/settings', settingsRoutes);
app.route('/api/v1/sync', syncRoutes);
app.route('/api/v1/analytics', analyticsRoutes);
app.route('/api/v1/reminders', reminderRoutes);
app.route('/api/v1/trips', tripRoutes);
app.route('/api/v1/shares', shareRoutes);
app.route('/api/v1/push', pushRoutes);

// Unversioned /api/* requests redirect to /api/v1. 308 keeps the HTTP method.
app.use('/api/*', async (c, next) => {
  const path = c.req.path;

  if (path.startsWith('/api/v') || path === '/api') {
    return next();
  }

  const newPath = path.replace('/api/', '/api/v1/');
  logger.debug('Redirecting to versioned API', { from: path, to: newPath });
  return c.redirect(newPath, 308);
});

app.get('/api', (c) => {
  return c.json({
    message: 'VROOM Car Tracker API',
    version: CONFIG.version,
    apiVersion: 'v1',
    deprecation: {
      message: 'Unversioned endpoints (/api/*) are deprecated and will redirect to /api/v1/*',
      recommendation: 'Please update your client to use versioned endpoints (/api/v1/*)',
    },
  });
});

// Must use the standard error envelope. Clients read error.message, which a string-valued error lacks.
app.notFound((c) =>
  c.json(
    createErrorResponse('NotFoundError', 'The requested endpoint does not exist', {
      path: c.req.path,
    }),
    404
  )
);

export { app };
