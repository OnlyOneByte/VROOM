import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { HTTPException } from 'hono/http-exception';
import { config } from './lib/config';
import { errorHandler } from './lib/middleware/error-handler';
import { rateLimiter } from './lib/middleware/rate-limiter';
import { auth } from './routes/auth';
import { requireAuth, optionalAuth } from './lib/middleware/auth';

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Rate limiting middleware
app.use('*', rateLimiter);

// CORS middleware with environment-based origins
app.use('*', cors({
  origin: config.cors.origins,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Logging middleware
app.use('*', logger());

// Pretty JSON in development
if (config.env === 'development') {
  app.use('*', prettyJSON());
}

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
      path: config.database.url
    }
  });
});

// Mount auth routes
app.route('/auth', auth);

// API info endpoint
app.get('/api', optionalAuth, (c) => {
  const user = c.get('user');
  
  return c.json({ 
    message: 'VROOM Car Tracker API v1.0',
    version: '1.0.0',
    environment: config.env,
    authenticated: !!user,
    user: user ? {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    } : null,
    endpoints: {
      health: '/health',
      auth: {
        login: '/auth/login/google',
        callback: '/auth/callback/google',
        logout: '/auth/logout',
        me: '/auth/me',
        refresh: '/auth/refresh'
      },
      vehicles: '/api/vehicles',
      expenses: '/api/expenses'
    }
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
    }
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ 
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    path: c.req.path
  }, 404);
});

console.log(`🚗 VROOM Backend starting on port ${config.server.port}`);
console.log(`📊 Environment: ${config.env}`);
console.log(`🗄️  Database: ${config.database.url}`);

export default {
  port: config.server.port,
  fetch: app.fetch,
};