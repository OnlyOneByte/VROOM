import { DrizzleSQLiteAdapter } from '@lucia-auth/adapter-drizzle';
import { Google } from 'arctic';
import { Lucia } from 'lucia';
import type { User } from '../db/schema';
import { sessions, users } from '../db/schema';
import { getTestDatabase } from './setup.js';

// Test-specific Lucia instance
let testLucia: Lucia | null = null;

export function getTestLucia() {
  if (!testLucia) {
    const testDb = getTestDatabase();
    if (!testDb) {
      throw new Error('Test database not initialized');
    }

    const adapter = new DrizzleSQLiteAdapter(testDb, sessions, users);

    testLucia = new Lucia(adapter, {
      sessionCookie: {
        attributes: {
          secure: false, // Always false for tests
          sameSite: 'lax',
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
  }

  return testLucia;
}

export function resetTestLucia() {
  testLucia = null;
}

// Test Google OAuth (using dummy values)
export const testGoogle = new Google(
  'test-client-id',
  'test-client-secret',
  'http://localhost:3001/auth/callback/google'
);

export type AuthUser = User;
