import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

const app = new Hono();

// Middleware
app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:4173'], // SvelteKit dev and preview
  credentials: true,
}));
app.use('*', logger());
app.use('*', prettyJSON());

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    message: 'VROOM Backend API is running',
    timestamp: new Date().toISOString()
  });
});

// API routes placeholder
app.get('/api', (c) => {
  return c.json({ 
    message: 'VROOM Car Tracker API v1.0',
    endpoints: {
      health: '/health',
      auth: '/auth/*',
      vehicles: '/api/vehicles',
      expenses: '/api/expenses'
    }
  });
});

const port = process.env.PORT || 3001;

console.log(`🚗 VROOM Backend starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};