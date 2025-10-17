import type { MiddlewareHandler } from 'hono';
import { checkpointWAL } from '../../db/connection';

// Middleware to checkpoint WAL after write operations
// This ensures data is persisted to the main database file
export const checkpointAfterWrite: MiddlewareHandler = async (c, next) => {
  await next();

  // Only checkpoint after successful write operations (POST, PUT, DELETE)
  const method = c.req.method;
  const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  if (isWriteOperation && c.res.status >= 200 && c.res.status < 300) {
    // Checkpoint in the background to avoid blocking the response
    setImmediate(() => {
      checkpointWAL();
    });
  }
};
