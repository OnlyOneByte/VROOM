import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { countNum } from '../../db/dialect';
import { type NewPhotoRef, type PhotoRef, photoRefs, userProviders } from '../../db/schema';
import { chunk } from '../../utils/chunk';

export interface UpdateStatusOptions {
  status: 'pending' | 'active' | 'failed';
  storageRef?: string;
  externalUrl?: string;
  errorMessage?: string;
  retryCount?: number;
  syncedAt?: Date;
}

export class PhotoRefRepository {
  constructor(private db: AppDatabase) {}

  async findActiveByPhotoAndProvider(
    photoId: string,
    providerId: string
  ): Promise<PhotoRef | null> {
    const result = await this.db
      .select()
      .from(photoRefs)
      .where(
        and(
          eq(photoRefs.photoId, photoId),
          eq(photoRefs.providerId, providerId),
          eq(photoRefs.status, 'active')
        )
      )
      .limit(1);
    return result[0] ?? null;
  }

  async findActiveByPhoto(photoId: string): Promise<PhotoRef | null> {
    const result = await this.db
      .select()
      .from(photoRefs)
      .where(and(eq(photoRefs.photoId, photoId), eq(photoRefs.status, 'active')))
      .orderBy(sql`${photoRefs.syncedAt} DESC`)
      .limit(1);
    return result[0] ?? null;
  }

  async create(data: NewPhotoRef): Promise<PhotoRef> {
    const result = await this.db.insert(photoRefs).values(data).returning();
    return result[0];
  }

  async updateStatus(id: string, options: UpdateStatusOptions): Promise<void> {
    const updates: Record<string, unknown> = { status: options.status };
    if (options.storageRef !== undefined) updates.storageRef = options.storageRef;
    if (options.externalUrl !== undefined) updates.externalUrl = options.externalUrl;
    if (options.errorMessage !== undefined) updates.errorMessage = options.errorMessage;
    if (options.retryCount !== undefined) updates.retryCount = options.retryCount;
    if (options.syncedAt !== undefined) updates.syncedAt = options.syncedAt;

    await this.db.update(photoRefs).set(updates).where(eq(photoRefs.id, id));
  }

  private providersSeenUpdatedAt: number | null = null;

  async findPendingOrFailed(limit: number): Promise<PhotoRef[]> {
    const queued = await this.db
      .select()
      .from(photoRefs)
      .where(
        and(inArray(photoRefs.status, ['pending', 'failed']), sql`${photoRefs.retryCount} < 3`)
      )
      .orderBy(asc(photoRefs.createdAt))
      .limit(limit);
    if (queued.length >= limit) return queued;
    return [...queued, ...(await this.findRevivedSinceProviderUpdate(limit - queued.length))];
  }

  private async findRevivedSinceProviderUpdate(limit: number): Promise<PhotoRef[]> {
    const [{ latest }] = await this.db
      .select({ latest: sql<number | null>`max(${userProviders.updatedAt})` })
      .from(userProviders)
      .where(eq(userProviders.domain, 'storage'));
    if (latest === null || latest === this.providersSeenUpdatedAt) return [];

    const revived = await this.db
      .select()
      .from(photoRefs)
      .where(
        and(
          eq(photoRefs.status, 'failed'),
          sql`${photoRefs.retryCount} >= 3`,
          sql`EXISTS (
            SELECT 1 FROM photo_refs AS involved
            JOIN user_providers AS provider ON provider.id = involved.provider_id
            WHERE (involved.id = ${photoRefs.id}
                OR (involved.photo_id = ${photoRefs.photoId} AND involved.status = 'active'))
              AND provider.updated_at > COALESCE(${photoRefs.syncedAt}, ${photoRefs.createdAt}, 0)
          )`
        )
      )
      .orderBy(asc(photoRefs.createdAt))
      .limit(limit);
    if (revived.length === 0) this.providersSeenUpdatedAt = latest;
    return revived;
  }

  async resetFailedForProvider(providerId: string): Promise<void> {
    await this.db
      .update(photoRefs)
      .set({ status: 'pending', retryCount: 0, errorMessage: null })
      .where(and(eq(photoRefs.providerId, providerId), eq(photoRefs.status, 'failed')));
  }

  async countPhotosOnlyOnProvider(providerId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: countNum() })
      .from(photoRefs)
      .where(
        and(
          eq(photoRefs.providerId, providerId),
          eq(photoRefs.status, 'active'),
          sql`NOT EXISTS (
            SELECT 1 FROM photo_refs AS other
            WHERE other.photo_id = ${photoRefs.photoId}
              AND other.provider_id != ${providerId}
              AND other.status = 'active'
          )`
        )
      );
    return Number(row?.count ?? 0);
  }

  async deleteByProvider(providerId: string): Promise<void> {
    await this.db.delete(photoRefs).where(eq(photoRefs.providerId, providerId));
  }

  async findAllByPhotos(photoIds: string[]): Promise<PhotoRef[]> {
    if (photoIds.length === 0) return [];
    const results: PhotoRef[] = [];
    for (const batch of chunk(photoIds)) {
      const rows = await this.db.select().from(photoRefs).where(inArray(photoRefs.photoId, batch));
      results.push(...rows);
    }
    return results;
  }

  async deleteByIds(refIds: string[]): Promise<void> {
    for (const batch of chunk(refIds)) {
      await this.db.delete(photoRefs).where(inArray(photoRefs.id, batch));
    }
  }

  async deleteByPhotos(photoIds: string[]): Promise<void> {
    if (photoIds.length === 0) return;
    for (const batch of chunk(photoIds)) {
      await this.db.delete(photoRefs).where(inArray(photoRefs.photoId, batch));
    }
  }
}
