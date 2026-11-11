import type { Table } from 'drizzle-orm';
import { z } from 'zod';
import packageJson from '../package.json';
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
  trips,
  userPreferences,
  vehicleFinancing,
  vehicleShares,
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
  // Default is the IPv4 loopback literal. A hostname like localhost can resolve to ::1 only, and an
  // omitted hostname binds every interface. Containers must set 0.0.0.0.
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().default('./data/vroom.db'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Must match a real route under /api/v1. The provider redirect URI below is derived from this value.
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/auth/callback/google'),
  GOOGLE_PROVIDER_REDIRECT_URI: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/auth/callback/github'),
  // No session secret: sessions are opaque ids in the sessions table, so nothing is signed with a configured key.
  FRONTEND_URL: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((origin) => origin.trim()) || []),
  // X-Forwarded-For is trusted only when the socket IP is in this list. Empty means no proxy header is trusted.
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
  // Tests and local E2E only. The storage factory also refuses it in production.
  ALLOW_FAKE_STORAGE: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
  DISABLE_RATE_LIMIT: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
  // Instance-wide push identity, set in the environment rather than per user. The private key never leaves
  // the server. Leaving any of the three unset disables push. Generate a pair with `bun run vapid:gen`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // mailto: or https: contact that the push service can reach.
  VAPID_SUBJECT: z.string().optional(),
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
  version: packageJson.version,
  allowFakeStorageProvider:
    env.ALLOW_FAKE_STORAGE && (env.NODE_ENV as Environment) !== 'production',
  // Double-gated: opt-in via env and never in production.
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
  // Only vapidPublicKey and vapidSubject may reach a response. The private key must never be exposed.
  push: {
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY,
    vapidSubject: env.VAPID_SUBJECT,
    enabled: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
  },
  pagination: { defaultPageSize: 20, maxPageSize: 100, minPageSize: 1 },
  syncWorker: {
    enabled: env.NODE_ENV !== 'test',
    pollIntervalMs: 30_000,
    batchSize: 10,
  },
  rateLimit: {
    cleanupInterval: 60_000,
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
    // Caps total decompressed bytes across all entries, so a zip bomb cannot exhaust memory.
    maxUncompressedSize: 200 * 1024 * 1024,
    // Checked against the real compressed size, because the declared size in the ZIP directory is
    // attacker-controlled. Real CSV compresses far below this ratio.
    maxCompressionRatio: 1000,
    // Bumped for integer-cents money. A pre-cents backup fails the version check instead of being
    // silently corrupted 100x. Restore's version-gated shim converts old backups.
    currentVersion: '2.0.0',
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
      locationMaxLength: 200,
      maxAmount: 1_000_000,
      maxTags: 10,
      tagMaxLength: 50,
      fuelTypeMaxLength: 50,
      // Caps rows per CSV import so a large file cannot exhaust memory.
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
      // Covers any realistic service interval while keeping nextDueOdometer within INTEGER range.
      maxIntervalMileage: 1_000_000,
      // Newest-first, so a reminder that fired often cannot return an unbounded list.
      notificationsHistoryLimit: 100,
    },
    settings: { maxBackupRetention: 100, maxSyncInactivityMinutes: 30 },
    push: {
      // Reaped after this many consecutive transient send failures, so a dead endpoint is not retried forever.
      maxConsecutiveFailures: 5,
      // A new device past this cap evicts the oldest subscription instead of being rejected.
      maxSubscriptionsPerUser: 20,
    },
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
  trips: trips,
  vehicleShares: vehicleShares,
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
  trips: 'trips.csv',
  vehicleShares: 'vehicle_shares.csv',
};

export function getBackupTableKeys(): string[] {
  return Object.keys(TABLE_SCHEMA_MAP);
}

// Exported so a test can check this is a subset of TABLE_FILENAME_MAP's values. A typo here would make
// an optional file required.
export const OPTIONAL_BACKUP_FILES = new Set([
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
  'trips.csv',
  'vehicle_shares.csv',
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
