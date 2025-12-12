/**
 * Merged Constants File
 *
 * This file consolidates all application constants from multiple files:
 * - app-config.ts (application configuration)
 * - rate-limits.ts (rate limiting configuration)
 * - sync.ts (backup and sync configuration)
 * - validation.ts (validation limits and constraints)
 *
 * All constants are exported from this single file for easier imports.
 */

import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import {
  expenses,
  insurancePolicies,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from '../db/schema';

// ============================================================================
// APPLICATION CONFIGURATION
// ============================================================================

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

// ============================================================================
// RATE LIMITING CONFIGURATION
// ============================================================================

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

// ============================================================================
// BACKUP AND SYNC CONFIGURATION
// ============================================================================

/**
 * Backup configuration
 */
export const BACKUP_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  CURRENT_VERSION: '1.0.0',
  SUPPORTED_MODES: ['preview', 'replace', 'merge'] as const,
  DEFAULT_RETENTION_COUNT: 10,
  MAX_RETENTION_COUNT: 50,
  MIN_RETENTION_COUNT: 1,
} as const;

export type RestoreMode = (typeof BACKUP_CONFIG.SUPPORTED_MODES)[number];

/**
 * Map of backup data keys to their corresponding table schemas
 * This is the single source of truth for which tables are included in backups
 */
// biome-ignore lint/suspicious/noExplicitAny: Generic table type requires any
export const TABLE_SCHEMA_MAP: Record<string, SQLiteTableWithColumns<any>> = {
  vehicles,
  expenses,
  financing: vehicleFinancing,
  financingPayments: vehicleFinancingPayments,
  insurance: insurancePolicies,
};

/**
 * Map of backup data keys to their CSV filenames
 */
export const TABLE_FILENAME_MAP: Record<string, string> = {
  vehicles: 'vehicles.csv',
  expenses: 'expenses.csv',
  financing: 'vehicle_financing.csv',
  financingPayments: 'vehicle_financing_payments.csv',
  insurance: 'insurance.csv',
};

/**
 * Get all backup table keys (excluding metadata)
 */
export function getBackupTableKeys(): string[] {
  return Object.keys(TABLE_SCHEMA_MAP);
}

/**
 * Get all required CSV filenames for backup validation
 */
export function getRequiredBackupFiles(): string[] {
  return ['metadata.json', ...Object.values(TABLE_FILENAME_MAP)];
}

// ============================================================================
// VALIDATION LIMITS
// ============================================================================

export const VALIDATION_LIMITS = {
  VEHICLE: {
    MAKE_MAX_LENGTH: 50,
    MODEL_MAX_LENGTH: 50,
    NICKNAME_MAX_LENGTH: 50,
    LICENSE_PLATE_MAX_LENGTH: 20,
    MIN_YEAR: 1900,
    VIN_MIN_LENGTH: 11,
    VIN_MAX_LENGTH: 17,
  },
  EXPENSE: {
    DESCRIPTION_MAX_LENGTH: 500,
    MAX_AMOUNT: 1_000_000,
    MAX_TAGS: 10,
    TAG_MAX_LENGTH: 50,
    FUEL_TYPE_MAX_LENGTH: 50,
  },
  INSURANCE: {
    COMPANY_MAX_LENGTH: 100,
    POLICY_NUMBER_MAX_LENGTH: 50,
    MAX_TERM_MONTHS: 24,
  },
  FINANCING: {
    PROVIDER_MAX_LENGTH: 100,
    MAX_APR: 50,
    MAX_TERM_MONTHS: 600,
    MIN_DAY_OF_MONTH: 1,
    MAX_DAY_OF_MONTH: 31,
    MIN_DAY_OF_WEEK: 0,
    MAX_DAY_OF_WEEK: 6,
  },
  SETTINGS: {
    MAX_BACKUP_RETENTION: 100,
    MAX_SYNC_INACTIVITY_MINUTES: 30,
  },
} as const;
