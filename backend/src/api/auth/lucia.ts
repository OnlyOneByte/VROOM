import { DrizzleSQLiteAdapter } from '@lucia-auth/adapter-drizzle';
import { type DatabaseSession, type DatabaseUser, Lucia, TimeSpan } from 'lucia';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import type { User } from '../../db/schema';
import { sessions, users } from '../../db/schema';
import { demoSessionExpiresAt } from './utils';

function cappedExpiry(sessionId: string, expiresAt: Date): Date {
  const demoExpiresAt = demoSessionExpiresAt(sessionId);
  return demoExpiresAt && demoExpiresAt < expiresAt ? demoExpiresAt : expiresAt;
}

class SessionAdapter extends DrizzleSQLiteAdapter {
  override async getSessionAndUser(
    sessionId: string
  ): Promise<[session: DatabaseSession | null, user: DatabaseUser | null]> {
    const demoExpiresAt = demoSessionExpiresAt(sessionId);
    if (demoExpiresAt && demoExpiresAt <= new Date()) {
      await this.deleteSession(sessionId);
      return [null, null];
    }
    return super.getSessionAndUser(sessionId);
  }

  override async setSession(session: DatabaseSession): Promise<void> {
    await super.setSession({ ...session, expiresAt: cappedExpiry(session.id, session.expiresAt) });
  }

  override async updateSessionExpiration(sessionId: string, expiresAt: Date): Promise<void> {
    if (demoSessionExpiresAt(sessionId)) return;
    await super.updateSessionExpiration(sessionId, expiresAt);
  }
}

const db = getDb();
const adapter = new SessionAdapter(db, sessions, users);

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
      pendingApprovalAt: attributes.pendingApprovalAt,
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
    pendingApprovalAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  }
}

interface DatabaseUserAttributes {
  id: string;
  email: string;
  displayName: string;
  pendingApprovalAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type AuthUser = Omit<User, 'disabledAt'>;
