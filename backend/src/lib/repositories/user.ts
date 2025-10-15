import { and, eq } from 'drizzle-orm';
import type { NewUser, User } from '../../db/schema.js';
import { users } from '../../db/schema.js';
import { BaseRepository } from './base.js';
import type { IUserRepository } from './interfaces.js';

export class UserRepository extends BaseRepository<User, NewUser> implements IUserRepository {
  constructor() {
    super(users);
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      const result = await this.database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(`Error finding user by email ${email}:`, error);
      throw new Error('Failed to find user by email');
    }
  }

  async findByProviderId(provider: string, providerId: string): Promise<User | null> {
    try {
      const result = await this.database
        .select()
        .from(users)
        .where(and(eq(users.provider, provider), eq(users.providerId, providerId)))
        .limit(1);
      return result[0] || null;
    } catch (error) {
      console.error(
        `Error finding user by provider ${provider} and providerId ${providerId}:`,
        error
      );
      throw new Error('Failed to find user by provider');
    }
  }

  async updateGoogleRefreshToken(id: string, token: string | null): Promise<User> {
    try {
      const result = await this.database
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
      console.error(`Error updating Google refresh token for user ${id}:`, error);
      throw new Error('Failed to update Google refresh token');
    }
  }
}
