import { createId } from '@paralleldrive/cuid2';
import { and, asc, count, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { UserProvider } from '../../db/schema';
import { userProviders } from '../../db/schema';

export class AuthProviderRepository {
  constructor(private db: AppDatabase) {}

  async findByProviderIdentity(
    authProvider: string,
    providerAccountId: string
  ): Promise<UserProvider | null> {
    const result = await this.db
      .select()
      .from(userProviders)
      .where(
        and(
          eq(userProviders.domain, 'auth'),
          eq(userProviders.providerType, authProvider),
          eq(userProviders.providerAccountId, providerAccountId)
        )
      )
      .limit(1);
    return result[0] ?? null;
  }

  async findByUserId(userId: string): Promise<UserProvider[]> {
    return this.db
      .select()
      .from(userProviders)
      .where(and(eq(userProviders.userId, userId), eq(userProviders.domain, 'auth')))
      .orderBy(asc(userProviders.createdAt));
  }

  async create(params: {
    userId: string;
    authProvider: string;
    providerAccountId: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<UserProvider> {
    const result = await this.db
      .insert(userProviders)
      .values({
        id: createId(),
        userId: params.userId,
        domain: 'auth',
        providerType: params.authProvider,
        providerAccountId: params.providerAccountId,
        displayName: params.displayName ?? params.email,
        credentials: '',
        config: { email: params.email, avatarUrl: params.avatarUrl },
        status: 'active',
      })
      .returning();
    return result[0];
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.db
      .delete(userProviders)
      .where(
        and(
          eq(userProviders.id, id),
          eq(userProviders.userId, userId),
          eq(userProviders.domain, 'auth')
        )
      );
  }

  async countByUserId(userId: string): Promise<number> {
    const result = await this.db
      .select({ value: count() })
      .from(userProviders)
      .where(and(eq(userProviders.userId, userId), eq(userProviders.domain, 'auth')));
    return result[0]?.value ?? 0;
  }

  async updateProfile(
    id: string,
    userId: string,
    profile: { email: string; displayName?: string; avatarUrl?: string }
  ): Promise<void> {
    await this.db
      .update(userProviders)
      .set({
        config: { email: profile.email, avatarUrl: profile.avatarUrl },
        displayName: profile.displayName ?? profile.email,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userProviders.id, id),
          eq(userProviders.userId, userId),
          eq(userProviders.domain, 'auth')
        )
      );
  }
}

export const authProviderRepository = new AuthProviderRepository(getDb());
