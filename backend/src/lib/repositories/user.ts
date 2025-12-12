import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { NewUser, User } from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { logger } from '../utils/logger';
import { BaseRepository } from './base.js';

export class UserRepository extends BaseRepository<User, NewUser> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, users);
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.queryBuilder.findOne(users, eq(users.email, email));
    } catch (error) {
      logger.error('Error finding user by email', { email, error });
      throw new Error('Failed to find user by email');
    }
  }

  async findByProviderId(provider: string, providerId: string): Promise<User | null> {
    try {
      const whereClause = and(eq(users.provider, provider), eq(users.providerId, providerId));
      if (!whereClause) {
        throw new Error('Invalid where clause');
      }
      return await this.queryBuilder.findOne(users, whereClause);
    } catch (error) {
      logger.error('Error finding user by provider', { provider, providerId, error });
      throw new Error('Failed to find user by provider');
    }
  }

  async updateGoogleRefreshToken(id: string, token: string | null): Promise<User> {
    try {
      const result = await this.db
        .update(users)
        .set({
          googleRefreshToken: token,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`User with id ${id} not found`);
      }

      return result[0];
    } catch (error) {
      logger.error('Error updating Google refresh token', { userId: id, error });
      throw new Error('Failed to update Google refresh token');
    }
  }
}
