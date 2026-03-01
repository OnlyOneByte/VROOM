import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { routes as authRoutes } from './api/auth/routes';
import { routes as expenseRoutes } from './api/expenses/routes';
import { routes as financingRoutes } from './api/financing/routes';
import { routes as insuranceRoutes } from './api/insurance/routes';
import { routes as settingsRoutes } from './api/settings/routes';
import { routes as syncRoutes } from './api/sync/routes';
import { routes as vehicleRoutes } from './api/vehicles/routes';
import { CONFIG } from './config';
import {
  activityTracker,
  bodyLimit,
  errorHandler,
  optionalAuth,
  rateLimiter,
  requireAuth,
} from './middleware';
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
  })
);

// Rate limiting middleware - global rate limiter
const globalRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.global,
  keyGenerator: (c) => {
    const user = c.get('user');
    return user?.id || c.req.header('x-forwarded-for') || 'anonymous';
  },
});

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

// Health check endpoint with detailed status
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    message: 'VROOM Backend API is running',
    timestamp: new Date().toISOString(),
    environment: CONFIG.env,
    version: '1.0.0',
    database: {
      status: 'connected',
      path: CONFIG.database.url,
    },
  });
});

// API Versioning - Mount v1 routes
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/vehicles', vehicleRoutes);
app.route('/api/v1/financing', financingRoutes);
app.route('/api/v1/expenses', expenseRoutes);
app.route('/api/v1/insurance', insuranceRoutes);
app.route('/api/v1/settings', settingsRoutes);
app.route('/api/v1/sync', syncRoutes);

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

// API info endpoint
app.get('/api', optionalAuth, (c) => {
  const user = c.get('user');

  return c.json({
    message: 'VROOM Car Tracker API',
    version: '1.0.0',
    apiVersion: 'v1',
    environment: CONFIG.env,
    authenticated: !!user,
    user: user
      ? {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        }
      : null,
    endpoints: {
      health: '/health',
      auth: {
        login: '/api/v1/auth/login/google',
        callback: '/api/v1/auth/callback/google',
        logout: '/api/v1/auth/logout',
        me: '/api/v1/auth/me',
        refresh: '/api/v1/auth/refresh',
      },
      vehicles: '/api/v1/vehicles',
      financing: '/api/v1/financing',
      expenses: '/api/v1/expenses',
      insurance: '/api/v1/insurance',
      settings: '/api/v1/settings',
      sync: '/api/v1/sync',
    },
    deprecation: {
      message: 'Unversioned endpoints (/api/*) are deprecated and will redirect to /api/v1/*',
      recommendation: 'Please update your client to use versioned endpoints (/api/v1/*)',
    },
  });
});

// Protected API example
app.get('/api/protected', requireAuth, (c) => {
  const user = c.get('user');

  return c.json({
    message: 'This is a protected endpoint',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
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

logger.startup(`VROOM Backend starting on port ${CONFIG.server.port}`);
logger.startup(`Environment: ${CONFIG.env}`);
logger.startup(`Database: ${CONFIG.database.url}`);

// Run migrations on startup (idempotent — only applies new migrations)
import { checkpointWAL, forceCheckpointWAL, runMigrations } from './db/connection';

try {
  await runMigrations();
} catch (error) {
  logger.error('Failed to run migrations on startup', { error });
  process.exit(1);
}

const checkpointInterval = setInterval(
  () => {
    checkpointWAL();
  },
  CONFIG.env === 'development'
    ? CONFIG.database.checkpointIntervalDev
    : CONFIG.database.checkpointIntervalProd
);

// Force checkpoint on startup to ensure any previous data is persisted
forceCheckpointWAL();

// Graceful shutdown handler
const shutdown = (signal: string) => {
  logger.shutdown(`Received ${signal}, shutting down gracefully...`);

  // Clear checkpoint interval
  clearInterval(checkpointInterval);

  // Final forced checkpoint before shutdown to ensure all data is persisted
  forceCheckpointWAL();

  process.exit(0);
};

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default {
  port: CONFIG.server.port,
  fetch: app.fetch,
  reusePort: true, // Allow port reuse for hot reload
};
