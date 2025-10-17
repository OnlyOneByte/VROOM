import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { config } from './lib/config';
import { activityTrackerMiddleware } from './lib/middleware/activity-tracker';
import { optionalAuth, requireAuth } from './lib/middleware/auth';
import { errorHandler } from './lib/middleware/error-handler';
import { rateLimiter } from './lib/middleware/rate-limiter';
import { analytics } from './routes/analytics';
import { auth } from './routes/auth';
import { expenses } from './routes/expenses';
import { financing } from './routes/financing';
import { insurance } from './routes/insurance';
import { settings } from './routes/settings';
import { sharing } from './routes/sharing';
import { sync } from './routes/sync';
import { vehicles } from './routes/vehicles';

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Rate limiting middleware
app.use('*', rateLimiter);

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

// Logging middleware
app.use('*', logger());

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

// Mount auth routes
app.route('/api/auth', auth);

// Mount API routes
app.route('/api/vehicles', vehicles);
app.route('/api/financing', financing);
app.route('/api/expenses', expenses);
app.route('/api/insurance', insurance);
app.route('/api/analytics', analytics);
app.route('/api/settings', settings);
app.route('/api/sharing', sharing);
app.route('/api/sync', sync);

// API info endpoint
app.get('/api', optionalAuth, (c) => {
  const user = c.get('user');

  return c.json({
    message: 'VROOM Car Tracker API v1.0',
    version: '1.0.0',
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
        login: '/api/auth/login/google',
        callback: '/api/auth/callback/google',
        logout: '/api/auth/logout',
        me: '/api/auth/me',
        refresh: '/api/auth/refresh',
      },
      vehicles: '/api/vehicles',
      financing: '/api/financing',
      expenses: '/api/expenses',
      analytics: '/api/analytics',
      sharing: '/api/sharing',
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

console.log(`🚗 VROOM Backend starting on port ${config.server.port}`);
console.log(`📊 Environment: ${config.env}`);
console.log(`🗄️  Database: ${config.database.url}`);

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
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

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
