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
import SHARED_LIMITS from './shared-limits.json';
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
  // Unset HOST binds every interface, and 'localhost' can resolve to ::1 only, so keep the IPv4 literal.
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().default('./data/vroom.db'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/auth/callback/google'),
  GOOGLE_PROVIDER_REDIRECT_URI: z.string().optional(),
  GOOGLE_LINK_REDIRECT_URI: z.string().optional(),
  PROVIDER_ENCRYPTION_KEY: z.string().optional(),
  PROVIDER_ENCRYPTION_KEYS: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().default('http://localhost:3001/api/v1/auth/callback/github'),
  GITHUB_LINK_REDIRECT_URI: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((origin) => origin.trim()) || []),
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
  ALLOW_FAKE_STORAGE: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
  BLOCK_PRIVATE_PROVIDER_ENDPOINTS: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
  DISABLE_RATE_LIMIT: z
    .string()
    .optional()
    .transform((val) => val === '1' || val === 'true'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
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

export function linkRedirectFrom(loginRedirectUri: string, provider: 'google' | 'github'): string {
  const base = loginRedirectUri.split(/[?#]/)[0].replace(/\/+$/, '');
  const loginSuffix = `/callback/${provider}`;
  if (base.endsWith(loginSuffix)) {
    return `${base.slice(0, -loginSuffix.length)}/callback/link/${provider}`;
  }
  const origin = /^https?:\/\/[^/]+/i.exec(base)?.[0];
  return origin ? `${origin}/api/v1/auth/callback/link/${provider}` : '';
}

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
  blockPrivateProviderEndpoints: env.BLOCK_PRIVATE_PROVIDER_ENDPOINTS,
  disableRateLimit: env.DISABLE_RATE_LIMIT && (env.NODE_ENV as Environment) !== 'production',
  server: { port: env.PORT, host: env.HOST },
  encryption: {
    providerKey: env.PROVIDER_ENCRYPTION_KEY,
    providerKeys: env.PROVIDER_ENCRYPTION_KEYS,
  },
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
    googleLoginRedirectUri: env.GOOGLE_REDIRECT_URI,
    googleStorageRedirectUri:
      env.GOOGLE_PROVIDER_REDIRECT_URI ||
      env.GOOGLE_REDIRECT_URI.replace('/callback/google', '/callback/provider/google'),
    googleLinkRedirectUri:
      env.GOOGLE_LINK_REDIRECT_URI || linkRedirectFrom(env.GOOGLE_REDIRECT_URI, 'google'),
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    githubRedirectUri: env.GITHUB_REDIRECT_URI,
    githubLinkRedirectUri:
      env.GITHUB_LINK_REDIRECT_URI || linkRedirectFrom(env.GITHUB_REDIRECT_URI, 'github'),
    cookieMaxAge: 30 * 24 * 60 * 60,
    sessionDuration: 30 * 24 * 60 * 60 * 1000,
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
    maxUncompressedSize: 200 * 1024 * 1024,
    // Measured from the real compressed size: the ZIP directory's declared size is attacker-controlled.
    maxCompressionRatio: 1000,
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
      minYear: SHARED_LIMITS.vehicle.minYear,
      maxYearsAhead: SHARED_LIMITS.vehicle.maxYearsAhead,
      vinMinLength: SHARED_LIMITS.vehicle.vinMinLength,
      vinMaxLength: SHARED_LIMITS.vehicle.vinMaxLength,
      maxOdometerReading: 10_000_000,
      maxPurchasePrice: 10_000_000,
    },
    expense: {
      descriptionMaxLength: 500,
      locationMaxLength: 200,
      maxAmount: SHARED_LIMITS.expense.maxAmount,
      maxVolume: 1_000,
      maxTags: 10,
      tagMaxLength: 50,
      fuelTypeMaxLength: 50,
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
      maxDeductible: 1_000_000,
      maxCoverageLimit: 100_000_000,
      maxClaimPayout: 10_000_000,
    },
    financing: {
      providerMaxLength: 100,
      maxOriginalAmount: 10_000_000,
      maxResidualValue: 10_000_000,
      maxExcessMileageFee: 1_000,
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
      maxIntervalMileage: 1_000_000,
      maxIntervalYears: 100,
      notificationsHistoryLimit: 100,
    },
    trip: { noteMaxLength: SHARED_LIMITS.trip.noteMaxLength },
    settings: { maxBackupRetention: 100, maxSyncInactivityMinutes: 30 },
    push: {
      maxConsecutiveFailures: 5,
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

const ENCRYPTION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const ENCRYPTION_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
export const LEGACY_ENCRYPTION_KEY_ID = 'default';

export interface EncryptionKeyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

function parseKeyEntry(entry: string): [string, Buffer] {
  const sep = entry.indexOf('=');
  const id = entry.slice(0, sep);
  const hex = entry.slice(sep + 1);
  if (sep < 1 || !ENCRYPTION_KEY_ID_PATTERN.test(id)) {
    throw new Error(
      'PROVIDER_ENCRYPTION_KEYS entries must look like id=hex, with an id of letters, digits, - or _'
    );
  }
  if (!ENCRYPTION_KEY_PATTERN.test(hex)) {
    throw new Error(
      `PROVIDER_ENCRYPTION_KEYS key "${id}" must be a 32-byte hex string (64 hex chars)`
    );
  }
  return [id, Buffer.from(hex, 'hex')];
}

export function parseEncryptionKeys(
  list: string | undefined,
  legacyKey: string | undefined
): EncryptionKeyring {
  const keys = new Map<string, Buffer>();
  for (const entry of (list ?? '').split(',').map((part) => part.trim())) {
    if (entry === '') continue;
    const [id, key] = parseKeyEntry(entry);
    if (keys.has(id)) {
      throw new Error(`PROVIDER_ENCRYPTION_KEYS lists the key id "${id}" twice`);
    }
    keys.set(id, key);
  }
  if (legacyKey && !keys.has(LEGACY_ENCRYPTION_KEY_ID)) {
    if (!ENCRYPTION_KEY_PATTERN.test(legacyKey)) {
      throw new Error('PROVIDER_ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)');
    }
    keys.set(LEGACY_ENCRYPTION_KEY_ID, Buffer.from(legacyKey, 'hex'));
  }
  const currentId = keys.keys().next().value;
  if (currentId === undefined) {
    throw new Error('PROVIDER_ENCRYPTION_KEY environment variable is not set');
  }
  return { currentId, keys };
}

function encryptionKeyListError(): string | null {
  const { providerKeys } = CONFIG.encryption;
  if (!providerKeys) return null;
  try {
    parseEncryptionKeys(providerKeys, undefined);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export const validateProductionConfig = () => {
  if (CONFIG.env === 'production') {
    requireProductionConfig();
  } else {
    warnAboutEncryptionKey();
  }
};

function requireProductionConfig(): void {
  const { providerKey, providerKeys } = CONFIG.encryption;
  const requiredFields = [
    { field: 'GOOGLE_CLIENT_ID', value: CONFIG.auth.googleClientId },
    { field: 'GOOGLE_CLIENT_SECRET', value: CONFIG.auth.googleClientSecret },
    { field: 'PROVIDER_ENCRYPTION_KEY', value: providerKey || providerKeys },
  ];

  const missing = requiredFields.filter(({ value }) => !value);

  if (missing.length > 0) {
    console.error('❌ Missing required production configuration:');
    for (const { field } of missing) {
      console.error(`  - ${field}`);
    }
    process.exit(1);
  }

  const keyListError = encryptionKeyListError();
  if (keyListError) {
    console.error(`❌ ${keyListError}`);
    process.exit(1);
  }

  if (providerKey && !ENCRYPTION_KEY_PATTERN.test(providerKey)) {
    console.error('❌ PROVIDER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    process.exit(1);
  }
}

function warnAboutEncryptionKey(): void {
  const { providerKey, providerKeys } = CONFIG.encryption;
  const keyListError = encryptionKeyListError();
  if (keyListError) {
    console.warn(`⚠️  ${keyListError}. Provider encryption will fail until it is fixed.`);
  } else if (!providerKey && !providerKeys) {
    console.warn(
      '⚠️  PROVIDER_ENCRYPTION_KEY is not set. Provider encryption will fail until configured.'
    );
  } else if (providerKey && !ENCRYPTION_KEY_PATTERN.test(providerKey)) {
    console.warn(
      '⚠️  PROVIDER_ENCRYPTION_KEY is not a 64-character hex string. Provider encryption will fail until it is. Generate one with: openssl rand -hex 32'
    );
  }
}

validateProductionConfig();
