/**
 * Consolidated Configuration Module
 *
 * This file consolidates all application configuration from:
 * - lib/constants.ts (application constants)
 * - lib/constants/index.ts
 * - lib/core/config.ts (environment configuration)
 *
 * Single source of truth for all configuration and constants.
 */

import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  expenses,
  insurancePolicies,
  vehicleFinancing,
  vehicleFinancingPayments,
  vehicles,
} from './db/schema';
import type { Environment } from './types';

// ============================================================================
// ENVIRONMENT VALIDATION AND PARSING
// ============================================================================

const envSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('3001')
    .transform((val) => {
      const port = Number(val);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be a valid port number (1-65535)');
      }
      return port;
    }),
  HOST: z.string().default('localhost'),

  // Database configuration
  DATABASE_URL: z.string().default('./data/vroom.db'),

  // Authentication configuration
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3001/auth/callback/google'),
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters').optional(),

  // Frontend URL for OAuth redirects
  FRONTEND_URL: z.string().optional(),

  // CORS origins (comma-separated)
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((origin) => origin.trim()) || []),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.issues.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

const env = parseEnv();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const getDefaultFrontendUrl = (environment: Environment): string => {
  switch (environment) {
    case 'production':
      return 'https://your-domain.com';
    case 'test':
      return 'http://localhost:3000';
    default:
      return 'http://localhost:5173';
  }
};

const getDefaultCorsOrigins = (environment: Environment): string[] => {
  switch (environment) {
    case 'production':
      return ['https://your-domain.com'];
    case 'test':
      return ['http://localhost:3000'];
    default:
      return [
        'http://localhost:5173',
        'http://localhost:4173',
        'http://localhost:3000',
        'http://localhost:3001',
      ];
  }
};

// ============================================================================
// CONSOLIDATED CONFIGURATION OBJECT
// ============================================================================

export const CONFIG = {
  // Environment
  env: env.NODE_ENV as Environment,

  // Server configuration
  server: {
    port: env.PORT,
    host: env.HOST,
  },

  // Database configuration
  database: {
    url: env.DATABASE_URL,
    cacheSize: 1_000_000,
    walCheckpointPages: 1000,
    checkpointIntervalDev: 5 * 60 * 1000, // 5 minutes
    checkpointIntervalProd: 15 * 60 * 1000, // 15 minutes
    queryTimeout: 30_000, // 30 seconds
  },

  // Authentication configuration
  auth: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    },
    session: {
      secret: env.SESSION_SECRET,
      cookieMaxAge: 30 * 24 * 60 * 60, // 30 days in seconds
      sessionDuration: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
      refreshThreshold: 24 * 60 * 60 * 1000, // 24 hours in ms
      oauthStateExpiry: 10 * 60 * 1000, // 10 minutes in ms
    },
  },

  // Frontend configuration
  frontend: {
    url: env.FRONTEND_URL || getDefaultFrontendUrl(env.NODE_ENV as Environment),
  },

  // CORS configuration
  cors: {
    origins:
      env.CORS_ORIGINS.length > 0
        ? env.CORS_ORIGINS
        : getDefaultCorsOrigins(env.NODE_ENV as Environment),
  },

  // Logging configuration
  logging: {
    level: env.LOG_LEVEL,
  },

  // Pagination configuration
  pagination: {
    defaultPageSize: 20,
    maxPageSize: 100,
    minPageSize: 1,
  },

  // Rate limiting configuration
  rateLimit: {
    cleanupInterval: 60_000, // 1 minute in ms
    global: {
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      message: 'Too many requests. Please wait before trying again.',
    },
    sync: {
      windowMs: 15 * 60 * 1000,
      limit: 50,
      message: 'Too many sync requests. Please wait before trying again.',
    },
    backup: {
      windowMs: 5 * 60 * 1000,
      limit: 20,
      message: 'Too many backup requests. Please wait before trying again.',
    },
    restore: {
      windowMs: 10 * 60 * 1000,
      limit: 10,
      message: 'Too many restore requests. Please wait before trying again.',
    },
    driveInit: {
      windowMs: 10 * 60 * 1000,
      limit: 3,
      message: 'Too many Drive initialization requests. Please wait before trying again.',
    },
  },

  // Backup configuration
  backup: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    currentVersion: '1.0.0',
    supportedModes: ['preview', 'replace', 'merge'] as const,
    defaultRetentionCount: 10,
    maxRetentionCount: 50,
    minRetentionCount: 1,
  },

  // Validation limits
  validation: {
    vehicle: {
      makeMaxLength: 50,
      modelMaxLength: 50,
      nicknameMaxLength: 50,
      licensePlateMaxLength: 20,
      minYear: 1900,
      vinMinLength: 11,
      vinMaxLength: 17,
    },
    expense: {
      descriptionMaxLength: 500,
      maxAmount: 1_000_000,
      maxTags: 10,
      tagMaxLength: 50,
      fuelTypeMaxLength: 50,
    },
    insurance: {
      companyMaxLength: 100,
      policyNumberMaxLength: 50,
      maxTermMonths: 24,
    },
    financing: {
      providerMaxLength: 100,
      maxApr: 50,
      maxTermMonths: 600,
      minDayOfMonth: 1,
      maxDayOfMonth: 31,
      minDayOfWeek: 0,
      maxDayOfWeek: 6,
    },
    settings: {
      maxBackupRetention: 100,
      maxSyncInactivityMinutes: 30,
    },
  },

  // Time constants
  time: {
    millisecondsPerSecond: 1000,
    secondsPerMinute: 60,
    minutesPerHour: 60,
    hoursPerDay: 24,
    daysPerMonth: 30, // Average for calculations
    msPerMinute: 60 * 1000,
    msPerHour: 60 * 60 * 1000,
    msPerDay: 24 * 60 * 60 * 1000,
    secondsPerHour: 60 * 60,
    secondsPerDay: 24 * 60 * 60,
  },
} as const;

// ============================================================================
// BACKUP TABLE CONFIGURATION
// ============================================================================

export type RestoreMode = (typeof CONFIG.backup.supportedModes)[number];

/**
 * Map of backup data keys to their corresponding table schemas
 * Single source of truth for which tables are included in backups
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
// PRODUCTION VALIDATION
// ============================================================================

export const validateProductionConfig = () => {
  if (CONFIG.env === 'production') {
    const requiredFields = [
      { field: 'GOOGLE_CLIENT_ID', value: CONFIG.auth.google.clientId },
      { field: 'GOOGLE_CLIENT_SECRET', value: CONFIG.auth.google.clientSecret },
      { field: 'SESSION_SECRET', value: CONFIG.auth.session.secret },
    ];

    const missing = requiredFields.filter(({ value }) => !value);

    if (missing.length > 0) {
      console.error('❌ Missing required production configuration:');
      missing.forEach(({ field }) => {
        console.error(`  - ${field}`);
      });
      process.exit(1);
    }
  }
};

// Run production validation on module load
validateProductionConfig();
