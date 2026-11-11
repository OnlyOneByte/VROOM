import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { type NewPhotoRef, type PhotoRef, photoRefs, photos } from '../../db/schema';
import { chunk } from '../../utils/chunk';

export interface UpdateStatusOptions {
  status: 'pending' | 'active' | 'failed';
  storageRef?: string;
  externalUrl?: string;
  errorMessage?: string;
  retryCount?: number;
  syncedAt?: Date;
}

/** Per-provider storage locations of photos (photo_refs table). */
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

  async findAllByPhoto(photoId: string): Promise<PhotoRef[]> {
    return this.db.select().from(photoRefs).where(eq(photoRefs.photoId, photoId));
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

  async deleteByProvider(providerId: string): Promise<void> {
    await this.db.delete(photoRefs).where(eq(photoRefs.providerId, providerId));
  }

  async deleteByPhoto(photoId: string): Promise<void> {
    await this.db.delete(photoRefs).where(eq(photoRefs.photoId, photoId));
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

  async deleteByPhotos(photoIds: string[]): Promise<void> {
    if (photoIds.length === 0) return;
    for (const batch of chunk(photoIds)) {
      await this.db.delete(photoRefs).where(inArray(photoRefs.photoId, batch));
    }
  }
}

// Defers getDb() until first use to avoid init-order coupling.
let _instance: PhotoRefRepository | null = null;
export function getPhotoRefRepository(): PhotoRefRepository {
  if (!_instance) {
    _instance = new PhotoRefRepository(getDb());
  }
  return _instance;
}

/** Proxy over getPhotoRefRepository(); defers getDb() until the first property access. */
export const photoRefRepository: PhotoRefRepository = new Proxy({} as PhotoRefRepository, {
  get(_target, prop, receiver) {
    return Reflect.get(getPhotoRefRepository(), prop, receiver);
  },
});
