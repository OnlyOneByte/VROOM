/**
 * Rate Limit Configuration
 * Centralized rate limit settings with rationale
 */

/**
 * Rate limiter system configuration
 */
export const RATE_LIMIT_CONFIG = {
  CLEANUP_INTERVAL: 60_000, // 1 minute in ms
} as const;

/**
 * Rate limit settings for specific endpoints
 */
export const RATE_LIMITS = {
  /**
   * Global rate limiter for all API endpoints
   * Prevents abuse while allowing normal usage
   * 100 requests per 15 minutes = ~400 requests/hour
   */
  GLOBAL: {
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    message: 'Too many requests. Please wait before trying again.',
  },

  /**
   * Sync operations (POST /api/sync)
   * Lower limit due to resource-intensive operations
   * 50 requests per 15 minutes = ~200 requests/hour
   */
  SYNC: {
    windowMs: 15 * 60 * 1000,
    limit: 50,
    message: 'Too many sync requests. Please wait before trying again.',
  },

  /**
   * Backup operations (download, list)
   * Moderate limit for backup management
   * 20 requests per 5 minutes = ~240 requests/hour
   */
  BACKUP: {
    windowMs: 5 * 60 * 1000,
    limit: 20,
    message: 'Too many backup requests. Please wait before trying again.',
  },

  /**
   * Restore operations (from backup, from sheets)
   * Lower limit due to data modification risk
   * 10 requests per 10 minutes = ~60 requests/hour
   */
  RESTORE: {
    windowMs: 10 * 60 * 1000,
    limit: 10,
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
