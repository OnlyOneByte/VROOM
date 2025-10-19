import 'reflect-metadata';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { config } from './lib/config';
import { activityTrackerMiddleware } from './lib/middleware/activity-tracker';
import { optionalAuth, requireAuth } from './lib/middleware/auth';
import { bodyLimit } from './lib/middleware/body-limit';
import { errorHandler } from './lib/middleware/error-handler';
import { rateLimiter } from './lib/middleware/rate-limiter';
import { logger } from './lib/utils/logger';
import { analytics } from './routes/analytics';
import { auth } from './routes/auth';
import { expenses } from './routes/expenses';
import { financing } from './routes/financing';
import { insurance } from './routes/insurance';
import { settings } from './routes/settings';
import { sharing } from './routes/sharing';
import { sync } from './routes/sync';
import { vehicleStats } from './routes/vehicle-stats';
import { vehicles } from './routes/vehicles';

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

// Security headers middleware - protects against common web vulnerabilities
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
app.use(
  '*',
  rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // 100 requests per window
    keyGenerator: (c) => {
      const user = c.get('user');
      return user?.id || c.req.header('x-forwarded-for') || 'anonymous';
    },
  })
);

// CORS middleware with environment-based origins
app.use(
  '*',
  cors({
    origin: config.cors.origins,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// CSRF protection middleware - protects against cross-site request forgery
// Only applies to state-changing methods (POST, PUT, DELETE, PATCH)
app.use(
  '*',
  csrf({
    origin: config.cors.origins,
  })
);

// Logging middleware
app.use('*', honoLogger());

// Pretty JSON in development
if (config.env === 'development') {
  app.use('*', prettyJSON());
}

// Activity tracking middleware (after auth middleware)
app.use('*', activityTrackerMiddleware);

// Health check endpoint with detailed status
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    message: 'VROOM Backend API is running',
    timestamp: new Date().toISOString(),
    environment: config.env,
    version: '1.0.0',
    database: {
      status: 'connected',
      path: config.database.url,
    },
  });
});

// API Versioning - Mount v1 routes
app.route('/api/v1/auth', auth);
app.route('/api/v1/vehicles', vehicles);
app.route('/api/v1/vehicles', vehicleStats);
app.route('/api/v1/financing', financing);
app.route('/api/v1/expenses', expenses);
app.route('/api/v1/insurance', insurance);
app.route('/api/v1/analytics', analytics);
app.route('/api/v1/settings', settings);
app.route('/api/v1/sharing', sharing);
app.route('/api/v1/sync', sync);

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
    environment: config.env,
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
      analytics: '/api/v1/analytics',
      settings: '/api/v1/settings',
      sharing: '/api/v1/sharing',
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

logger.startup(`VROOM Backend starting on port ${config.server.port}`);
logger.startup(`Environment: ${config.env}`);
logger.startup(`Database: ${config.database.url}`);

// Periodic WAL checkpoint to ensure data persistence
// Auto-checkpoint (1000 pages) handles most cases, this is just a safety net
import { checkpointWAL, forceCheckpointWAL } from './db/connection';

const checkpointInterval = setInterval(
  () => {
    checkpointWAL();
  },
  config.env === 'development' ? 5 * 60 * 1000 : 15 * 60 * 1000
); // 5 minutes in dev, 15 minutes in prod

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
  port: config.server.port,
  fetch: app.fetch,
  reusePort: true, // Allow port reuse for hot reload
};
