/**
 * Database configuration constants
 */
export const DATABASE_CONFIG = {
  CACHE_SIZE: 1_000_000,
  WAL_CHECKPOINT_PAGES: 1000,
  CHECKPOINT_INTERVAL_DEV: 5 * 60 * 1000, // 5 minutes
  CHECKPOINT_INTERVAL_PROD: 15 * 60 * 1000, // 15 minutes
  QUERY_TIMEOUT: 30_000, // 30 seconds
} as const;
