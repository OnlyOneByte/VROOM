/**
 * Validation middleware for backup and sync operations
 */

import type { Context, Next } from 'hono';
import { SyncError, SyncErrorCode } from '../services/sync/sync-errors';

/**
 * Validate file ID parameter
 */
export async function validateFileIdMiddleware(c: Context, next: Next) {
  const fileId = c.req.param('fileId');

  if (!fileId || typeof fileId !== 'string' || fileId.trim() === '') {
    throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'fileId parameter is required');
  }

  c.set('fileId', fileId);
  await next();
}
