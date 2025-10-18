/**
 * Body size limit middleware for Hono
 */

import type { Context, Next } from 'hono';
import { createErrorResponse } from '../utils/error-response';

interface BodyLimitConfig {
  maxSize: number; // Maximum size in bytes
  message?: string;
}

/**
 * Create a body size limit middleware
 */
export function bodyLimit(config: BodyLimitConfig) {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header('content-length');

    if (contentLength) {
      const size = Number.parseInt(contentLength, 10);

      if (size > config.maxSize) {
        const sizeMB = (size / 1024 / 1024).toFixed(2);
        const maxSizeMB = (config.maxSize / 1024 / 1024).toFixed(2);

        return c.json(
          createErrorResponse(
            'PAYLOAD_TOO_LARGE',
            config.message ||
              `Request body exceeds maximum size of ${maxSizeMB}MB (received: ${sizeMB}MB)`
          ),
          413
        );
      }
    }

    return next();
  };
}
