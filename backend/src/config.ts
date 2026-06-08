/**
 * Configuration Module - Environment variables, validation, and constants
 */

import type { Table } from 'drizzle-orm';
import { z } from 'zod';
import {
  expenses,
  insuranceClaims,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  odometerEntries,
  photoRefs,
  photos,
  reminderNotifications,
  reminders,
  reminderVehicles,
  syncState,
  userPreferences,
  vehicleFinancing,
  vehicles,
} from './db/schema';
import type { Environment } from './types';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('3001')
    .transform((val) => {
      const port = Number(val);
      if (Number.isNaN(port) || port < 1 || port > 65535)
        throw new Error('PORT must be valid (1-65535)');
      return port;
    }),
  HOST: z.string().default('localhost'),
  DATABASE_URL: z.string().default('./data/vroom.db'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3001/auth/callback/google'),
  GOOGLE_PROVIDER_REDIRECT_URI: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/auth/callback/github'),
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters').optional(),
  FRONTEND_URL: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((origin) => origin.trim()) || []),
  // Comma-separated IPs of trusted reverse proxies (e.g. your load balancer).
  // `X-Forwarded-For` is ONLY honored when the request's actual socket IP is in
  // this list — otherwise the spoofable header is ignored and the real socket IP
  // is used. Empty by default (direct-exposure safe; no header is trusted).
  TRUSTED_PROXY_IPS: z
    .string()
    .optional()
    .transform((val) =>
      (val ?? '')
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean)
    ),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  // Allow the in-memory FakeStorageProvider (tests / local E2E only). Never set
  // in production — the factory also hard-gates on env !== 'production'.
  ALLOW_FAKE_STORAGE: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
  // Disable in-memory rate limiting for the local E2E harness, whose own request
  // volume (route-smoke hits every route + many API calls, repeated across runs)
  // exhausts the 1000/15min global window and flakes late specs with 429s. Never
  // set in production — double-gated on env !== 'production' below.
  DISABLE_RATE_LIMIT: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
});

const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      for (const err of error.issues) {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      }
      process.exit(1);
    }
    throw error;
  }
};

const env = parseEnv();

const getDefaultFrontendUrl = (environment: Environment): string => {
  if (environment === 'production') return 'https://your-domain.com';
  if (environment === 'test') return 'http://localhost:3000';
  return 'http://localhost:5173';
};

const getDefaultCorsOrigins = (environment: Environment): string[] => {
  if (environment === 'production') return ['https://your-domain.com'];
  if (environment === 'test') return ['http://localhost:3000'];
  return [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://localhost:3001',
  ];
};

export const CONFIG = {
  env: env.NODE_ENV as Environment,
  // Fake storage provider is allowed only outside production AND only when
  // explicitly opted in via ALLOW_FAKE_STORAGE — double-gated.
  allowFakeStorageProvider:
    env.ALLOW_FAKE_STORAGE && (env.NODE_ENV as Environment) !== 'production',
  // Rate limiting is bypassed only outside production AND only when explicitly opted
  // in via DISABLE_RATE_LIMIT (the local E2E harness) — double-gated, can never
  // weaken production's abuse protection.
  disableRateLimit: env.DISABLE_RATE_LIMIT && (env.NODE_ENV as Environment) !== 'production',
  server: { port: env.PORT, host: env.HOST },
  database: {
    url: env.DATABASE_URL,
    cacheSize: 1_000_000,
    walCheckpointPages: 1000,
    checkpointIntervalDev: 5 * 60 * 1000,
    checkpointIntervalProd: 15 * 60 * 1000,
    queryTimeout: 30_000,
  },
  auth: {
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: env.GOOGLE_REDIRECT_URI,
    googleProviderRedirectUri:
      env.GOOGLE_PROVIDER_REDIRECT_URI ||
      env.GOOGLE_REDIRECT_URI.replace('/callback/google', '/callback/provider/google'),
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    githubRedirectUri: env.GITHUB_REDIRECT_URI,
    sessionSecret: env.SESSION_SECRET,
    cookieMaxAge: 30 * 24 * 60 * 60,
    sessionDuration: 30 * 24 * 60 * 60 * 1000,
    refreshThreshold: 24 * 60 * 60 * 1000,
    oauthStateExpiry: 10 * 60 * 1000,
  },
  frontend: { url: env.FRONTEND_URL || getDefaultFrontendUrl(env.NODE_ENV as Environment) },
  cors: {
    origins:
      env.CORS_ORIGINS.length > 0
        ? env.CORS_ORIGINS
        : getDefaultCorsOrigins(env.NODE_ENV as Environment),
  },
  logging: { level: env.LOG_LEVEL },
  pagination: { defaultPageSize: 20, maxPageSize: 100, minPageSize: 1 },
  syncWorker: {
    enabled: env.NODE_ENV !== 'test',
    pollIntervalMs: 30_000,
    batchSize: 10,
  },
  rateLimit: {
    cleanupInterval: 60_000,
    // Reverse proxies whose `X-Forwarded-For` we trust (see env TRUSTED_PROXY_IPS).
    trustedProxyIps: env.TRUSTED_PROXY_IPS,
    global: { windowMs: 15 * 60 * 1000, limit: 1000, message: 'Too many requests' },
    auth: { windowMs: 15 * 60 * 1000, limit: 30 },
    sync: { windowMs: 15 * 60 * 1000, limit: 50, message: 'Too many sync requests' },
    backup: { windowMs: 5 * 60 * 1000, limit: 20, message: 'Too many backup requests' },
    restore: { windowMs: 10 * 60 * 1000, limit: 10, message: 'Too many restore requests' },
    trigger: { windowMs: 15 * 60 * 1000, limit: 10, message: 'Too many trigger requests' },
  },
  backup: {
    maxFileSize: 50 * 1024 * 1024,
    // Cap on TOTAL uncompressed bytes across all entries in an uploaded backup
    // ZIP. bodyLimit caps the compressed upload (maxFileSize); this guards the
    // decompressed size so a zip bomb can't inflate to many GB and OOM the
    // process. Generous vs any real backup (CSV text), tiny vs a bomb.
    maxUncompressedSize: 200 * 1024 * 1024,
    currentVersion: '1.0.0',
    supportedModes: ['preview', 'replace', 'merge'] as const,
    defaultRetentionCount: 10,
    maxRetentionCount: 50,
    minRetentionCount: 1,
  },
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
      // CSV import: hard cap on rows accepted in a single import request so a huge
      // (or malicious) file can't exhaust memory/CPU parsing+validating row-by-row.
      maxImportRows: 5000,
    },
    insurance: {
      companyMaxLength: 100,
      policyNumberMaxLength: 50,
      maxTermMonths: 24,
      maxTerms: 50,
      notesMaxLength: 2000,
      coverageDescriptionMaxLength: 500,
      agentNameMaxLength: 100,
      agentPhoneMaxLength: 30,
      agentEmailMaxLength: 100,
      premiumFrequencyMaxLength: 50,
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
    reminder: {
      nameMaxLength: 100,
      descriptionMaxLength: 500,
      maxExpenseAmount: 1_000_000,
      maxCatchUpOccurrences: 12,
      maxTags: 10,
      tagMaxLength: 50,
      // Cap the notification-history feed so a long-lapsed reminder that fired
      // many times can't return an unbounded list to the UI (newest-first).
      notificationsHistoryLimit: 100,
    },
    settings: { maxBackupRetention: 100, maxSyncInactivityMinutes: 30 },
  },
} as const;

export const TABLE_SCHEMA_MAP: Record<string, Table> = {
  vehicles,
  expenses,
  financing: vehicleFinancing,
  insurance: insurancePolicies,
  insuranceTerms: insuranceTerms,
  insuranceTermVehicles: insuranceTermVehicles,
  insuranceClaims: insuranceClaims,
  photos: photos,
  odometer: odometerEntries,
  photoRefs: photoRefs,
  userPreferences: userPreferences,
  syncState: syncState,
  reminders: reminders,
  reminderVehicles: reminderVehicles,
  reminderNotifications: reminderNotifications,
};

export const TABLE_FILENAME_MAP: Record<string, string> = {
  vehicles: 'vehicles.csv',
  expenses: 'expenses.csv',
  financing: 'vehicle_financing.csv',
  insurance: 'insurance_policies.csv',
  insuranceTerms: 'insurance_terms.csv',
  insuranceTermVehicles: 'insurance_term_vehicles.csv',
  insuranceClaims: 'insurance_claims.csv',
  photos: 'photos.csv',
  odometer: 'odometer_entries.csv',
  photoRefs: 'photo_refs.csv',
  userPreferences: 'user_preferences.csv',
  syncState: 'sync_state.csv',
  reminders: 'reminders.csv',
  reminderVehicles: 'reminder_vehicles.csv',
  reminderNotifications: 'reminder_notifications.csv',
};

export function getBackupTableKeys(): string[] {
  return Object.keys(TABLE_SCHEMA_MAP);
}

// Files that may be absent in older backups (pre-migration)
const OPTIONAL_BACKUP_FILES = new Set([
  'insurance_terms.csv',
  'insurance_term_vehicles.csv',
  'insurance_claims.csv',
  'photos.csv',
  'odometer_entries.csv',
  'photo_refs.csv',
  'user_preferences.csv',
  'sync_state.csv',
  'reminders.csv',
  'reminder_vehicles.csv',
  'reminder_notifications.csv',
]);

export function getRequiredBackupFiles(): string[] {
  return [
    'metadata.json',
    ...Object.values(TABLE_FILENAME_MAP).filter((f) => !OPTIONAL_BACKUP_FILES.has(f)),
  ];
}

export const validateProductionConfig = () => {
  const encryptionKey = process.env.PROVIDER_ENCRYPTION_KEY;

  if (CONFIG.env === 'production') {
    const requiredFields = [
      { field: 'GOOGLE_CLIENT_ID', value: CONFIG.auth.googleClientId },
      { field: 'GOOGLE_CLIENT_SECRET', value: CONFIG.auth.googleClientSecret },
      { field: 'SESSION_SECRET', value: CONFIG.auth.sessionSecret },
    ];

    const missing = requiredFields.filter(({ value }) => !value);

    if (!encryptionKey) {
      missing.push({ field: 'PROVIDER_ENCRYPTION_KEY', value: undefined });
    }

    if (missing.length > 0) {
      console.error('❌ Missing required production configuration:');
      for (const { field } of missing) {
        console.error(`  - ${field}`);
      }
      process.exit(1);
    }

    // Validate encryption key format (must be 64-char hex = 32 bytes)
    if (encryptionKey && !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
      console.error('❌ PROVIDER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
      process.exit(1);
    }
  } else if (!encryptionKey) {
    console.warn(
      '⚠️  PROVIDER_ENCRYPTION_KEY is not set. Provider encryption will fail until configured.'
    );
  }
};

validateProductionConfig();
