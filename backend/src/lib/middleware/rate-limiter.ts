import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { config } from '../config';

// Simple in-memory rate limiter
// Note: In production, consider using Redis or a more sophisticated solution
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const rateLimiter: MiddlewareHandler = async (c, next) => {
  // Skip rate limiting in test environment
  if (config.env === 'test') {
    return next();
  }

  const clientIP = c.req.header('x-forwarded-for') || 
                   c.req.header('x-real-ip') || 
                   'unknown';
  
  const now = Date.now();
  const windowMs = config.rateLimit.windowMs;
  const maxRequests = config.rateLimit.max;
  
  // Get or create request count for this IP
  let requestData = requestCounts.get(clientIP);
  
  if (!requestData || now > requestData.resetTime) {
    // Reset window
    requestData = {
      count: 0,
      resetTime: now + windowMs,
    };
    requestCounts.set(clientIP, requestData);
  }
  
  requestData.count++;
  
  // Check if limit exceeded
  if (requestData.count > maxRequests) {
    const resetIn = Math.ceil((requestData.resetTime - now) / 1000);
    
    throw new HTTPException(429, {
      message: `Too many requests. Try again in ${resetIn} seconds.`,
    });
  }
  
  // Add rate limit headers
  c.res.headers.set('X-RateLimit-Limit', maxRequests.toString());
  c.res.headers.set('X-RateLimit-Remaining', (maxRequests - requestData.count).toString());
  c.res.headers.set('X-RateLimit-Reset', Math.ceil(requestData.resetTime / 1000).toString());
  
  return next();
};

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000);