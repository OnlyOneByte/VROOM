import { createId } from '@paralleldrive/cuid2';
import { and, asc, count, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { UserProvider } from '../../db/schema';
import { userProviders } from '../../db/schema';

/**
 * The shape of an auth-domain provider's `config` blob (the OAuth identity profile). One source of
 * truth for the `{ email, avatarUrl }` object that was hand-assembled at 3 write sites (C283 dedup):
 * create + updateProfile here, and the new-user insert in auth/routes.ts. It's read back via
 * `config.email` / `config.avatarUrl`, so the write sites must stay in lockstep — a future field
 * (e.g. locale) is then added in one place, not three.
 */
export function buildAuthProviderConfig(
  email: string,
  avatarUrl?: string
): { email: string; avatarUrl?: string } {
  return { email, avatarUrl };
}

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
        config: buildAuthProviderConfig(params.email, params.avatarUrl),
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
        config: buildAuthProviderConfig(profile.email, profile.avatarUrl),
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
