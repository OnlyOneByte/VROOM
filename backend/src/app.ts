/**
 * Hono application factory — PURE app construction (middleware + routes), with
 * NO side effects (no migrations, no setInterval, no sync worker, no signal
 * handlers, no server start). `index.ts` imports this and adds the runtime side
 * effects; tests import this and drive it via `app.request()` against an
 * in-memory DB. Keeping construction side-effect-free is what makes the backend
 * testable in-process.
 */

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
import { activityTracker, bodyLimit, errorHandler, optionalAuth, rateLimiter } from './middleware';
import { getClientIp } from './utils/client-ip';
import { logger } from './utils/logger';

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Body size limit middleware - prevents DoS attacks via large payloads
app.use(
  '*',
  bodyLimit({
    maxSize: 10 * 1024 * 1024, // 10MB
    message: 'Request body too large',
  })
);

/**
 * Security Headers Configuration
 *
 * Content Security Policy (CSP) is configured for maximum security.
 *
 * NOTE: If you add features that require external resources, you may need to adjust:
 * - imgSrc: Add specific domains for external images (e.g., Google Drive thumbnails)
 * - connectSrc: Add API domains for external services
 * - fontSrc: Add CDN domains if using external fonts
 *
 * Example for Google Drive integration:
 *   imgSrc: ["'self'", 'data:', 'https:', 'https://drive.google.com']
 *   connectSrc: ["'self'", 'https://www.googleapis.com']
 */
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

// Rate limiting middleware - global rate limiter
const globalRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.global,
  keyGenerator: (c) => {
    // Authenticated requests key by user id; anonymous ones by the TRUSTED client IP
    // (real socket IP, or X-Forwarded-For only behind a configured trusted proxy) —
    // not the raw spoofable header.
    const user = c.get('user');
    return `global:${user?.id || getClientIp(c)}`;
  },
});

// Optional auth - sets user context if session cookie present (before rate limiter so it can key by user)
// Scoped to /api/* to avoid unnecessary DB lookups on health checks and static paths
app.use('/api/*', optionalAuth);

app.use('*', globalRateLimiter);

// CORS middleware with environment-based origins
app.use(
  '*',
  cors({
    origin: CONFIG.cors.origins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  })
);

// CSRF protection middleware - protects against cross-site request forgery
// Only applies to state-changing methods (POST, PUT, DELETE, PATCH)
app.use(
  '*',
  csrf({
    origin: CONFIG.cors.origins,
  })
);

// Logging middleware
app.use('*', honoLogger());

// Pretty JSON in development
if (CONFIG.env === 'development') {
  app.use('*', prettyJSON());
}

// Activity tracking middleware (after auth middleware)
app.use('*', activityTracker);

// Health check endpoint — minimal response, no internal details
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API Versioning - Mount v1 routes
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/vehicles', vehicleRoutes);
app.route('/api/v1/financing', financingRoutes);
app.route('/api/v1/expenses', expenseRoutes);
app.route('/api/v1/insurance', insuranceRoutes);
app.route('/api/v1/odometer', odometerRoutes);
// Mount the receipt-draft stage endpoint BEFORE the generic photo routes so its fixed
// /receipt-drafts path is matched before the /:entityType/:entityId wildcard.
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

// Backward compatibility: Redirect /api/* to /api/v1/* (except /api root)
app.use('/api/*', async (c, next) => {
  const path = c.req.path;

  // Skip if already versioned or is the root /api endpoint
  if (path.startsWith('/api/v') || path === '/api') {
    return next();
  }

  // Redirect to v1 with permanent redirect (308 preserves method)
  const newPath = path.replace('/api/', '/api/v1/');
  logger.debug('Redirecting to versioned API', { from: path, to: newPath });
  return c.redirect(newPath, 308);
});

// API info endpoint — no PII, no route enumeration
app.get('/api', (c) => {
  return c.json({
    message: 'VROOM Car Tracker API',
    version: '1.0.0',
    apiVersion: 'v1',
    deprecation: {
      message: 'Unversioned endpoints (/api/*) are deprecated and will redirect to /api/v1/*',
      recommendation: 'Please update your client to use versioned endpoints (/api/v1/*)',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: 'The requested endpoint does not exist',
      path: c.req.path,
    },
    404
  );
});

export { app };
