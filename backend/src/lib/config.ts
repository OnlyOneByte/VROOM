import { z } from 'zod';

// Environment schema validation
const envSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  
  // Database configuration
  DATABASE_URL: z.string().default('./data/vroom.db'),
  
  // Authentication configuration
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3001/auth/callback/google'),
  SESSION_SECRET: z.string().min(32, 'Session secret must be at least 32 characters').optional(),
  
  // Google Drive API (for backup/sync)
  GOOGLE_DRIVE_API_KEY: z.string().optional(),
});

// Parse and validate environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

const env = parseEnv();

// Configuration object
export const config = {
  env: env.NODE_ENV,
  
  server: {
    port: env.PORT,
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
    origins: env.NODE_ENV === 'production' 
      ? ['https://your-domain.com'] // Update with actual production domain
      : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'],
  },
  
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: env.NODE_ENV === 'production' ? 100 : 1000, // Limit each IP to 100 requests per windowMs in production
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