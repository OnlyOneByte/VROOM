import { z } from 'zod';
import type { Environment } from '../types/enums';

// Environment schema validation
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

  // Google Drive API (for backup/sync)
  GOOGLE_DRIVE_API_KEY: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform(Number), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform(Number),

  // CORS origins (comma-separated)
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((origin) => origin.trim()) || []),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

// Parse and validate environment variables
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

// Default CORS origins based on environment
const getDefaultCorsOrigins = (environment: Environment): string[] => {
  switch (environment) {
    case 'production':
      return ['https://your-domain.com']; // Update with actual production domain
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

// Configuration object
export const config = {
  env: env.NODE_ENV as Environment,

  server: {
    port: env.PORT,
    host: env.HOST,
  },

  database: {
    url: env.DATABASE_URL,
  },

  auth: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    },
    session: {
      secret: env.SESSION_SECRET,
    },
  },

  googleDrive: {
    apiKey: env.GOOGLE_DRIVE_API_KEY,
  },

  cors: {
    origins:
      env.CORS_ORIGINS.length > 0
        ? env.CORS_ORIGINS
        : getDefaultCorsOrigins(env.NODE_ENV as Environment),
  },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
  },

  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

// Validate required configuration for production
export const validateProductionConfig = () => {
  if (config.env === 'production') {
    const requiredFields = [
      { field: 'GOOGLE_CLIENT_ID', value: config.auth.google.clientId },
      { field: 'GOOGLE_CLIENT_SECRET', value: config.auth.google.clientSecret },
      { field: 'SESSION_SECRET', value: config.auth.session.secret },
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

// Run production validation
validateProductionConfig();
