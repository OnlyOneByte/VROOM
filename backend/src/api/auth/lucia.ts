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
      createdAt: attributes.createdAt,
      updatedAt: attributes.updatedAt,
    };
  },
});

// Initialize Google OAuth — provider flow (separate redirect URI, offline access for storage)
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
    createdAt: Date | null;
    updatedAt: Date | null;
  }
}

interface DatabaseUserAttributes {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type AuthUser = User;

/**
 * The Lucia seam used by auth routes + middleware (12 sites). Kept as a stable indirection
 * point even though it now just returns the singleton: the old test-override (setTestLucia +
 * a `testLucia` module-state) was dead — never called anywhere incl. tests (tests drive the
 * real Lucia via the in-process createTestApp harness with a real session cookie), so the
 * override could never fire and `getLucia()` always returned `lucia`. Removed the dead seam.
 */
export function getLucia(): Lucia {
  return lucia;
}
