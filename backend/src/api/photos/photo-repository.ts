import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { type NewPhoto, type Photo, photos } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { chunk } from '../../utils/chunk';
import type { PaginatedResult } from '../../utils/pagination';

/** Entity-agnostic data access for photos. User-scoped queries filter on photos.user_id directly. */
export class PhotoRepository {
  constructor(private db: AppDatabase) {}

  async findByUser(userId: string, entityType?: string): Promise<Photo[]> {
    const conditions = [eq(photos.userId, userId)];
    if (entityType) {
      conditions.push(eq(photos.entityType, entityType));
    }
    return this.db
      .select()
      .from(photos)
      .where(and(...conditions))
      .orderBy(asc(photos.createdAt));
  }

  async findByEntity(entityType: string, entityId: string): Promise<Photo[]> {
    return this.db
      .select()
      .from(photos)
      .where(and(eq(photos.entityType, entityType), eq(photos.entityId, entityId)))
      .orderBy(asc(photos.sortOrder), asc(photos.createdAt));
  }

  /** Batched to stay under SQLite's bound-parameter limit. */
  async findByEntities(entityType: string, entityIds: string[]): Promise<Photo[]> {
    if (entityIds.length === 0) return [];
    const out: Photo[] = [];
    for (const batch of chunk(entityIds)) {
      const rows = await this.db
        .select()
        .from(photos)
        .where(and(eq(photos.entityType, entityType), inArray(photos.entityId, batch)));
      out.push(...rows);
    }
    return out;
  }

  async findByEntityPaginated(
    entityType: string,
    entityId: string,
    userId: string,
    limit: number,
    offset: number
  ): Promise<PaginatedResult<Photo>> {
    // Scoped by userId in the query itself, so a caller that skips the ownership check cannot page
    // another user's photos.
    const whereClause = and(
      eq(photos.entityType, entityType),
      eq(photos.entityId, entityId),
      eq(photos.userId, userId)
    );

    const [countResult, data] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)` }).from(photos).where(whereClause),
      this.db
        .select()
        .from(photos)
        .where(whereClause)
        .orderBy(asc(photos.sortOrder), asc(photos.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const totalCount = countResult[0]?.count ?? 0;
    return { data, totalCount };
  }

  async findById(photoId: string): Promise<Photo | null> {
    const result = await this.db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
    return result[0] || null;
  }

  async create(data: NewPhoto): Promise<Photo> {
    const result = await this.db.insert(photos).values(data).returning();
    return result[0];
  }

  async setCoverPhoto(entityType: string, entityId: string, photoId: string): Promise<Photo> {
    // Uses the instance db rather than the module-level transaction() helper so the injected connection
    // is used and NotFoundError is not wrapped as a 500.
    return this.db.transaction(async (tx) => {
      // Validate before any write: a throw after a write in a bun:sqlite async transaction does not roll
      // that write back, and a photo from another entity must never become this entity's cover.
      const target = await tx
        .select({ id: photos.id })
        .from(photos)
        .where(
          and(
            eq(photos.id, photoId),
            eq(photos.entityType, entityType),
            eq(photos.entityId, entityId)
          )
        )
        .limit(1);

      if (target.length === 0) {
        throw new NotFoundError('Photo');
      }

      await tx
        .update(photos)
        .set({ isCover: false })
        .where(and(eq(photos.entityType, entityType), eq(photos.entityId, entityId)));

      const result = await tx
        .update(photos)
        .set({ isCover: true })
        .where(eq(photos.id, photoId))
        .returning();

      return result[0];
    });
  }

  async delete(photoId: string): Promise<void> {
    await this.db.delete(photos).where(eq(photos.id, photoId));
  }

  async deleteByEntity(entityType: string, entityId: string): Promise<void> {
    await this.db
      .delete(photos)
      .where(and(eq(photos.entityType, entityType), eq(photos.entityId, entityId)));
  }

  async deleteByEntities(entityType: string, entityIds: string[]): Promise<void> {
    if (entityIds.length === 0) return;
    for (const batch of chunk(entityIds)) {
      await this.db
        .delete(photos)
        .where(and(eq(photos.entityType, entityType), inArray(photos.entityId, batch)));
    }
  }
}

export const photoRepository = new PhotoRepository(getDb());
