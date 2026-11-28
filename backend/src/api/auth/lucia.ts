import { DrizzlePostgreSQLAdapter, DrizzleSQLiteAdapter } from '@lucia-auth/adapter-drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { type Adapter, type DatabaseSession, type DatabaseUser, Lucia, TimeSpan } from 'lucia';
import { CONFIG } from '../../config';
import type { AsyncPgDatabase } from '../../db/async-postgres';
import type { SqliteAppDatabase } from '../../db/async-sqlite';
import * as pg from '../../db/pg/schema';
import type { User } from '../../db/schema';
import * as sqlite from '../../db/sqlite/schema';
import { demoSessionExpiresAt } from './utils';

function cappedExpiry(sessionId: string, expiresAt: Date): Date {
  const demoExpiresAt = demoSessionExpiresAt(sessionId);
  return demoExpiresAt && demoExpiresAt < expiresAt ? demoExpiresAt : expiresAt;
}

class SessionAdapter implements Adapter {
  constructor(private readonly inner: Adapter) {}

  async getSessionAndUser(
    sessionId: string
  ): Promise<[session: DatabaseSession | null, user: DatabaseUser | null]> {
    const demoExpiresAt = demoSessionExpiresAt(sessionId);
    if (demoExpiresAt && demoExpiresAt <= new Date()) {
      await this.inner.deleteSession(sessionId);
      return [null, null];
    }
    return this.inner.getSessionAndUser(sessionId);
  }

  getUserSessions(userId: string): Promise<DatabaseSession[]> {
    return this.inner.getUserSessions(userId);
  }

  async setSession(session: DatabaseSession): Promise<void> {
    await this.inner.setSession({
      ...session,
      expiresAt: cappedExpiry(session.id, session.expiresAt),
    });
  }

  async updateSessionExpiration(sessionId: string, expiresAt: Date): Promise<void> {
    if (demoSessionExpiresAt(sessionId)) return;
    await this.inner.updateSessionExpiration(sessionId, expiresAt);
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.inner.deleteSession(sessionId);
  }

  deleteUserSessions(userId: string): Promise<void> {
    return this.inner.deleteUserSessions(userId);
  }

  deleteExpiredSessions(): Promise<void> {
    return this.inner.deleteExpiredSessions();
  }
}

type SessionDatabase =
  | { dialect: 'sqlite'; db: SqliteAppDatabase }
  | { dialect: 'pg'; db: AsyncPgDatabase };

const pgSessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: pg.epochSeconds('expires_at').notNull(),
});

function driverAdapter(database: SessionDatabase): Adapter {
  if (database.dialect === 'pg') {
    return new DrizzlePostgreSQLAdapter(database.db, pgSessions, pg.users as never);
  }
  return new DrizzleSQLiteAdapter(database.db, sqlite.sessions, sqlite.users);
}

export function createLucia(db: SqliteAppDatabase): ReturnType<typeof luciaFor>;
export function createLucia(db: AsyncPgDatabase, dialect: 'pg'): ReturnType<typeof luciaFor>;
export function createLucia(
  db: SqliteAppDatabase | AsyncPgDatabase,
  dialect: 'sqlite' | 'pg' = 'sqlite'
) {
  const target = { dialect, db } as SessionDatabase;
  return luciaFor(target);
}

function luciaFor(target: SessionDatabase) {
  return new Lucia(new SessionAdapter(driverAdapter(target)), {
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
}

declare module 'lucia' {
  interface Register {
    Lucia: ReturnType<typeof luciaFor>;
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
