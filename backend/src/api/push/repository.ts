import { and, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import type { NewPushSubscription, PushSubscription } from '../../db/schema';
import { pushSubscriptions } from '../../db/schema';
import { DatabaseError } from '../../errors';
import { logger } from '../../utils/logger';
import { BaseRepository } from '../../utils/repository';

// ============================================================================
// Repository — per-user, per-device Web Push subscriptions (push-notifications T1)
// ============================================================================

/**
 * The subscription store. Every method is userId-SCOPED — the endpoint alone NEVER authorizes a
 * read/write (the IDOR discipline NORTH_STAR #2). A user owns many devices, each one row; an
 * idempotent upsert keys on (userId, endpoint) so a browser re-subscribing updates its row rather
 * than duplicating it. Mirrors the reminder_notifications userId-owned-row shape.
 */
export class PushSubscriptionRepository extends BaseRepository<
  PushSubscription,
  NewPushSubscription
> {
  constructor(db: AppDatabase) {
    super(db, pushSubscriptions);
  }

  /**
   * Idempotently persist a subscription for a user. A re-subscribe from the SAME browser returns the
   * SAME endpoint, so conflict on (userId, endpoint) UPDATES the stored keys + resets failureCount
   * (the device is alive again) rather than inserting a duplicate. Returns the stored row.
   */
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
      return result[0] as PushSubscription;
    } catch (error) {
      logger.error('Failed to upsert push subscription', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to upsert push subscription', error);
    }
  }

  /** All of a user's subscriptions (every device). UserId-scoped. */
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

  /**
   * Remove a user's subscription by endpoint (the unsubscribe path). UserId-scoped so a user can only
   * delete their OWN subscription — the endpoint is not a capability. Returns true if a row was removed.
   */
  async deleteByEndpoint(userId: string, endpoint: string): Promise<boolean> {
    const result = await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning();
    return result.length > 0;
  }

  /** Mark a successful send: clear the failure streak + stamp lastSuccessAt. */
  async markSuccess(id: string): Promise<void> {
    await this.db
      .update(pushSubscriptions)
      .set({ failureCount: 0, lastSuccessAt: new Date() })
      .where(eq(pushSubscriptions.id, id));
  }

  /** Increment the consecutive-failure counter (a transient send error); returns the new count. */
  async incrementFailure(id: string): Promise<number> {
    const result = await this.db
      .update(pushSubscriptions)
      .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(eq(pushSubscriptions.id, id))
      .returning();
    return (result[0] as PushSubscription | undefined)?.failureCount ?? 0;
  }

  /** Reap a dead subscription by id (a 404/410 "gone" result, or a row past the failure cap). */
  async prune(id: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }
}

// Export singleton instance
export const pushSubscriptionRepository = new PushSubscriptionRepository(getDb());
