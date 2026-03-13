import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { type NewPhotoRef, type PhotoRef, photoRefs, photos } from '../../db/schema';

export interface UpdateStatusOptions {
  status: 'pending' | 'active' | 'failed';
  storageRef?: string;
  externalUrl?: string;
  errorMessage?: string;
  retryCount?: number;
  syncedAt?: Date;
}

/**
 * Data access layer for the photo_refs table.
 * Manages the mapping between logical photos and their physical storage locations
 * across providers.
 */
export class PhotoRefRepository {
  constructor(private db: AppDatabase) {}

  /** Find an active ref for a specific photo on a specific provider. */
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
  /** Find all refs for a photo (any status). Used for cleanup on photo deletion. */
  async findAllByPhoto(photoId: string): Promise<PhotoRef[]> {
    return this.db.select().from(photoRefs).where(eq(photoRefs.photoId, photoId));
  }

  /** Find any active ref for a photo (fallback — most recently synced). */
  async findActiveByPhoto(photoId: string): Promise<PhotoRef | null> {
    const result = await this.db
      .select()
      .from(photoRefs)
      .where(and(eq(photoRefs.photoId, photoId), eq(photoRefs.status, 'active')))
      .orderBy(sql`${photoRefs.syncedAt} DESC`)
      .limit(1);
    return result[0] ?? null;
  }

  /** Insert a new photo ref. */
  async create(data: NewPhotoRef): Promise<PhotoRef> {
    const result = await this.db.insert(photoRefs).values(data).returning();
    return result[0];
  }

  /** Update a ref's status and optional fields (storageRef, externalUrl, errorMessage, retryCount, syncedAt). */
  async updateStatus(id: string, options: UpdateStatusOptions): Promise<void> {
    const updates: Record<string, unknown> = { status: options.status };
    if (options.storageRef !== undefined) updates.storageRef = options.storageRef;
    if (options.externalUrl !== undefined) updates.externalUrl = options.externalUrl;
    if (options.errorMessage !== undefined) updates.errorMessage = options.errorMessage;
    if (options.retryCount !== undefined) updates.retryCount = options.retryCount;
    if (options.syncedAt !== undefined) updates.syncedAt = options.syncedAt;

    await this.db.update(photoRefs).set(updates).where(eq(photoRefs.id, id));
  }

  /** Find refs that need syncing (pending or failed with retries remaining). */
  async findPendingOrFailed(limit: number): Promise<PhotoRef[]> {
    return this.db
      .select()
      .from(photoRefs)
      .where(
        and(inArray(photoRefs.status, ['pending', 'failed']), sql`${photoRefs.retryCount} < 3`)
      )
      .orderBy(asc(photoRefs.createdAt))
      .limit(limit);
  }

  /** Count active refs for a provider filtered by entity types (joined with photos). */
  async countByProviderAndCategory(providerId: string, entityTypes: string[]): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(photoRefs)
      .innerJoin(photos, eq(photoRefs.photoId, photos.id))
      .where(
        and(
          eq(photoRefs.providerId, providerId),
          eq(photoRefs.status, 'active'),
          inArray(photos.entityType, entityTypes)
        )
      );
    return result[0]?.count ?? 0;
  }

  /** Delete all refs for a provider (cleanup on provider deletion). */
  async deleteByProvider(providerId: string): Promise<void> {
    await this.db.delete(photoRefs).where(eq(photoRefs.providerId, providerId));
  }

  /** Delete all refs for a photo (cleanup on photo deletion). */
  async deleteByPhoto(photoId: string): Promise<void> {
    await this.db.delete(photoRefs).where(eq(photoRefs.photoId, photoId));
  }

  /** SQLite variable limit safe batch size */
  private readonly BATCH_SIZE = 500;

  /** Find all refs for multiple photos (batch). Used for cascade deletes. */
  async findAllByPhotos(photoIds: string[]): Promise<PhotoRef[]> {
    if (photoIds.length === 0) return [];
    const results: PhotoRef[] = [];
    for (let i = 0; i < photoIds.length; i += this.BATCH_SIZE) {
      const batch = photoIds.slice(i, i + this.BATCH_SIZE);
      const rows = await this.db.select().from(photoRefs).where(inArray(photoRefs.photoId, batch));
      results.push(...rows);
    }
    return results;
  }

  /** Delete all refs for multiple photos (batch). */
  async deleteByPhotos(photoIds: string[]): Promise<void> {
    if (photoIds.length === 0) return;
    for (let i = 0; i < photoIds.length; i += this.BATCH_SIZE) {
      const batch = photoIds.slice(i, i + this.BATCH_SIZE);
      await this.db.delete(photoRefs).where(inArray(photoRefs.photoId, batch));
    }
  }
}

// Lazy singleton — defers getDb() until first use to avoid init-order coupling.
let _instance: PhotoRefRepository | null = null;
export function getPhotoRefRepository(): PhotoRefRepository {
  if (!_instance) {
    _instance = new PhotoRefRepository(getDb());
  }
  return _instance;
}

/**
 * Direct singleton for backward compat with existing import sites.
 * Uses a Proxy to defer getDb() until first property access.
 */
export const photoRefRepository: PhotoRefRepository = new Proxy({} as PhotoRefRepository, {
  get(_target, prop, receiver) {
    return Reflect.get(getPhotoRefRepository(), prop, receiver);
  },
});
