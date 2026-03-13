import { DrizzleSQLiteAdapter } from '@lucia-auth/adapter-drizzle';
import { Google } from 'arctic';
import { Lucia, TimeSpan } from 'lucia';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import type { User } from '../../db/schema';
import { sessions, users } from '../../db/schema';

// Initialize Drizzle adapter for Lucia
const db = getDb();
const adapter = new DrizzleSQLiteAdapter(db, sessions, users);

// Initialize Lucia
export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: CONFIG.env === 'production',
      sameSite: 'lax',
    },
  },
  sessionExpiresIn: new TimeSpan(30, 'd'), // 30 days
  getUserAttributes: (attributes) => {
    return {
      id: attributes.id,
      email: attributes.email,
      displayName: attributes.displayName,
      provider: attributes.provider,
      providerId: attributes.providerId,
    };
  },
});

// Initialize Google OAuth — login flow
export const google = new Google(
  CONFIG.auth.googleClientId || '',
  CONFIG.auth.googleClientSecret || '',
  CONFIG.auth.googleRedirectUri
);

// Initialize Google OAuth — provider flow (separate redirect URI)
export const googleProvider = new Google(
  CONFIG.auth.googleClientId || '',
  CONFIG.auth.googleClientSecret || '',
  CONFIG.auth.googleProviderRedirectUri
);

// Type declarations for Lucia
declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: DatabaseUserAttributes;
  }

  interface User {
    id: string;
    email: string;
    displayName: string;
    provider: string;
    providerId: string;
    createdAt: Date | null;
    updatedAt: Date | null;
  }
}

interface DatabaseUserAttributes {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  providerId: string;
}

export type AuthUser = User;

// Test support functions
let testLucia: Lucia | null = null;

export function getLucia(): Lucia {
  return testLucia || lucia;
}

export function setTestLucia(instance: Lucia | null): void {
  testLucia = instance;
}
