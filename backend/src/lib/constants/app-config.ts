/**
 * Application-level configuration constants
 *
 * ARCHITECTURAL DECISION: Merged Small Constants Files
 * =====================================================
 * This file consolidates four small constants files that were 5-15 lines each:
 * - database.ts (7 lines)
 * - pagination.ts (5 lines)
 * - session.ts (6 lines)
 * - time.ts (15 lines)
 *
 * Why merge?
 * - All are app-level configuration (not domain-specific)
 * - Easier to find all app config in one place
 * - Reduces file count without losing organization
 * - Nested structure maintains clear grouping
 *
 * Usage:
 * ```typescript
 * import { APP_CONFIG } from './constants/app-config';
 * const pageSize = APP_CONFIG.PAGINATION.DEFAULT_PAGE_SIZE;
 * const sessionDuration = APP_CONFIG.SESSION.COOKIE_MAX_AGE;
 * ```
 */
export const APP_CONFIG = {
  /**
   * Database configuration constants
   */
  DATABASE: {
    CACHE_SIZE: 1_000_000,
    WAL_CHECKPOINT_PAGES: 1000,
    CHECKPOINT_INTERVAL_DEV: 5 * 60 * 1000, // 5 minutes
    CHECKPOINT_INTERVAL_PROD: 15 * 60 * 1000, // 15 minutes
    QUERY_TIMEOUT: 30_000, // 30 seconds
  },

  /**
   * Pagination configuration constants
   */
  PAGINATION: {
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    MIN_PAGE_SIZE: 1,
  },

  /**
   * Session and authentication configuration constants
   */
  SESSION: {
    COOKIE_MAX_AGE: 30 * 24 * 60 * 60, // 30 days in seconds
    SESSION_DURATION: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
    REFRESH_THRESHOLD: 24 * 60 * 60 * 1000, // 24 hours in ms
    OAUTH_STATE_EXPIRY: 10 * 60 * 1000, // 10 minutes in ms
  },

  /**
   * Time-related constants
   */
  TIME: {
    MILLISECONDS_PER_SECOND: 1000,
    SECONDS_PER_MINUTE: 60,
    MINUTES_PER_HOUR: 60,
    HOURS_PER_DAY: 24,
    DAYS_PER_MONTH: 30, // Average for calculations

    // Derived constants
    MS_PER_MINUTE: 60 * 1000,
    MS_PER_HOUR: 60 * 60 * 1000,
    MS_PER_DAY: 24 * 60 * 60 * 1000,

    SECONDS_PER_HOUR: 60 * 60,
    SECONDS_PER_DAY: 24 * 60 * 60,
  },
} as const;
