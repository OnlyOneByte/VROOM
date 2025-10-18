/**
 * Rate Limit Configuration
 * Centralized rate limit settings with rationale
 */

export const RATE_LIMITS = {
  /**
   * Sync operations (POST /api/sync)
   * Lower limit due to resource-intensive operations
   * 5 requests per 15 minutes = ~20 requests/hour
   */
  SYNC: {
    windowMs: 15 * 60 * 1000,
    limit: 5,
    message: 'Too many sync requests. Please wait before trying again.',
  },

  /**
   * Backup operations (download, list)
   * Moderate limit for backup management
   * 10 requests per 5 minutes = ~120 requests/hour
   */
  BACKUP: {
    windowMs: 5 * 60 * 1000,
    limit: 10,
    message: 'Too many backup requests. Please wait before trying again.',
  },

  /**
   * Restore operations (from backup, from sheets)
   * Lower limit due to data modification risk
   * 5 requests per 10 minutes = ~30 requests/hour
   */
  RESTORE: {
    windowMs: 10 * 60 * 1000,
    limit: 5,
    message: 'Too many restore requests. Please wait before trying again.',
  },

  /**
   * Drive initialization
   * Very restrictive due to folder creation overhead
   * 3 requests per 10 minutes = ~18 requests/hour
   */
  DRIVE_INIT: {
    windowMs: 10 * 60 * 1000,
    limit: 3,
    message: 'Too many Drive initialization requests. Please wait before trying again.',
  },
} as const;
