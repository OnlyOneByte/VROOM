import { Lucia } from 'lucia';
import { DrizzleSQLiteAdapter } from '@lucia-auth/adapter-drizzle';
import { Google } from 'arctic';
import { databaseService } from '../database';
import { sessions, users } from '../../db/schema';
import { config } from '../config';
import type { User } from '../../db/schema';

// Initialize Drizzle adapter for Lucia
const db = databaseService.getDatabase();
const adapter = new DrizzleSQLiteAdapter(db, sessions, users);

// Initialize Lucia
export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: config.env === 'production',
      sameSite: 'lax',
      httpOnly: true,
    },
  },
  getUserAttributes: (attributes) => {
    return {
      id: attributes.id,
      email: attributes.email,
      displayName: attributes.displayName,
      provider: attributes.provider,
      providerId: attributes.providerId,
      googleRefreshToken: attributes.googleRefreshToken,
    };
  },
});

// Initialize Google OAuth
export const google = new Google(
  config.auth.google.clientId || '',
  config.auth.google.clientSecret || '',
  config.auth.google.redirectUri
);

// Type declarations for Lucia
declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: DatabaseUserAttributes;
  }
}

interface DatabaseUserAttributes {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  providerId: string;
  googleRefreshToken: string | null;
}

export type AuthUser = User;