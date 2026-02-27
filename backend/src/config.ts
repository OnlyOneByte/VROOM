/**
 * Configuration Module - Environment variables, validation, and constants
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
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters').optional(),
  FRONTEND_URL: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((origin) => origin.trim()) || []),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
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
  rateLimit: {
    cleanupInterval: 60_000,
    global: { windowMs: 15 * 60 * 1000, limit: 1000, message: 'Too many requests' },
    sync: { windowMs: 15 * 60 * 1000, limit: 50, message: 'Too many sync requests' },
    backup: { windowMs: 5 * 60 * 1000, limit: 20, message: 'Too many backup requests' },
    restore: { windowMs: 10 * 60 * 1000, limit: 10, message: 'Too many restore requests' },
    driveInit: { windowMs: 10 * 60 * 1000, limit: 3, message: 'Too many Drive init requests' },
  },
  backup: {
    maxFileSize: 50 * 1024 * 1024,
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
    },
    insurance: { companyMaxLength: 100, policyNumberMaxLength: 50, maxTermMonths: 24 },
    financing: {
      providerMaxLength: 100,
      maxApr: 50,
      maxTermMonths: 600,
      minDayOfMonth: 1,
      maxDayOfMonth: 31,
      minDayOfWeek: 0,
      maxDayOfWeek: 6,
    },
    settings: { maxBackupRetention: 100, maxSyncInactivityMinutes: 30 },
  },
} as const;

export type RestoreMode = (typeof CONFIG.backup.supportedModes)[number];

// biome-ignore lint/suspicious/noExplicitAny: Generic table type
export const TABLE_SCHEMA_MAP: Record<string, SQLiteTableWithColumns<any>> = {
  vehicles,
  expenses,
  financing: vehicleFinancing,
  financingPayments: vehicleFinancingPayments,
  insurance: insurancePolicies,
};

export const TABLE_FILENAME_MAP: Record<string, string> = {
  vehicles: 'vehicles.csv',
  expenses: 'expenses.csv',
  financing: 'vehicle_financing.csv',
  financingPayments: 'vehicle_financing_payments.csv',
  insurance: 'insurance.csv',
};

export function getBackupTableKeys(): string[] {
  return Object.keys(TABLE_SCHEMA_MAP);
}

export function getRequiredBackupFiles(): string[] {
  return ['metadata.json', ...Object.values(TABLE_FILENAME_MAP)];
}

export const validateProductionConfig = () => {
  if (CONFIG.env === 'production') {
    const requiredFields = [
      { field: 'GOOGLE_CLIENT_ID', value: CONFIG.auth.googleClientId },
      { field: 'GOOGLE_CLIENT_SECRET', value: CONFIG.auth.googleClientSecret },
      { field: 'SESSION_SECRET', value: CONFIG.auth.sessionSecret },
    ];

    const missing = requiredFields.filter(({ value }) => !value);
    if (missing.length > 0) {
      console.error('❌ Missing required production configuration:');
      for (const { field } of missing) {
        console.error(`  - ${field}`);
      }
      process.exit(1);
    }
  }
};

validateProductionConfig();
