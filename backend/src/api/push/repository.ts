import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { CONFIG } from '../../config';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewPushSubscription, PushSubscription } from '../../db/schema';
import { pushSubscriptions } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

// Every method is scoped by userId: the endpoint alone is not a capability.
export class PushSubscriptionRepository extends BaseRepository<
  PushSubscription,
  NewPushSubscription
> {
  constructor(db: AppDatabase) {
    super(db, pushSubscriptions);
  }

  async upsertByEndpoint(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }
  ): Promise<PushSubscription> {
    try {
      const result = await this.db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
          userAgent: sub.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
          set: {
            p256dh: sub.p256dh,
            auth: sub.auth,
            userAgent: sub.userAgent ?? null,
            failureCount: 0,
          },
        })
        .returning();
      const stored = result[0] as PushSubscription;
      await this.evictOldestBeyondCap(userId);
      return stored;
    } catch (error) {
      logger.error('Failed to upsert push subscription', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to upsert push subscription', error);
    }
  }

  private async evictOldestBeyondCap(userId: string): Promise<void> {
    const cap = CONFIG.validation.push.maxSubscriptionsPerUser;
    const rows = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id));
    if (rows.length <= cap) return;
    const surplusIds = rows.slice(0, rows.length - cap).map((r) => r.id);
    await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, surplusIds));
  }

  async findByUser(userId: string): Promise<PushSubscription[]> {
    try {
      return await this.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
    } catch (error) {
      logger.error('Failed to find push subscriptions', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to find push subscriptions', error);
    }
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<boolean> {
    const result = await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning();
    return result.length > 0;
  }

  async markSuccess(id: string): Promise<void> {
    await this.db
      .update(pushSubscriptions)
      .set({ failureCount: 0, lastSuccessAt: new Date() })
      .where(eq(pushSubscriptions.id, id));
  }

  async incrementFailure(id: string): Promise<number> {
    const result = await this.db
      .update(pushSubscriptions)
      .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(eq(pushSubscriptions.id, id))
      .returning();
    return (result[0] as PushSubscription | undefined)?.failureCount ?? 0;
  }

  async prune(id: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }
}

export const pushSubscriptionRepository = new PushSubscriptionRepository(getDb());
