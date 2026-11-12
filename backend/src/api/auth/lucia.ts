import { DrizzleSQLiteAdapter } from '@lucia-auth/adapter-drizzle';
import { Lucia, TimeSpan } from 'lucia';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import type { User } from '../../db/schema';
import { sessions, users } from '../../db/schema';

const db = getDb();
const adapter = new DrizzleSQLiteAdapter(db, sessions, users);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: CONFIG.env === 'production',
      sameSite: 'lax',
    },
  },
  sessionExpiresIn: new TimeSpan(30, 'd'),
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
