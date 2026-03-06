import { and, asc, eq, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb, transaction } from '../../db/connection';
import { type NewPhoto, type Photo, photos } from '../../db/schema';
import { NotFoundError } from '../../errors';
import type { PaginatedResult } from '../../utils/pagination';

/**
 * Generic PhotoRepository — entity-agnostic data access for the photos table.
 * All queries are scoped by both entityType and entityId (polymorphic pattern).
 * Does NOT extend BaseRepository since the base class doesn't support entity-scoped queries.
 */
export class PhotoRepository {
  constructor(private db: BunSQLiteDatabase<Record<string, unknown>>) {}

  async findByEntity(entityType: string, entityId: string): Promise<Photo[]> {
    return this.db
      .select()
      .from(photos)
      .where(and(eq(photos.entityType, entityType), eq(photos.entityId, entityId)))
      .orderBy(asc(photos.sortOrder), asc(photos.createdAt));
  }

  async findByEntityPaginated(
    entityType: string,
    entityId: string,
    limit: number,
    offset: number
  ): Promise<PaginatedResult<Photo>> {
    const whereClause = and(eq(photos.entityType, entityType), eq(photos.entityId, entityId));

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

  async findCoverPhoto(entityType: string, entityId: string): Promise<Photo | null> {
    const result = await this.db
      .select()
      .from(photos)
      .where(
        and(
          eq(photos.entityType, entityType),
          eq(photos.entityId, entityId),
          eq(photos.isCover, true)
        )
      )
      .limit(1);
    return result[0] || null;
  }

  async create(data: NewPhoto): Promise<Photo> {
    const result = await this.db.insert(photos).values(data).returning();
    return result[0];
  }

  async setCoverPhoto(entityType: string, entityId: string, photoId: string): Promise<Photo> {
    return transaction(async (tx) => {
      // Unset all covers for this entity
      await tx
        .update(photos)
        .set({ isCover: false })
        .where(and(eq(photos.entityType, entityType), eq(photos.entityId, entityId)));

      // Set the target photo as cover
      const result = await tx
        .update(photos)
        .set({ isCover: true })
        .where(eq(photos.id, photoId))
        .returning();

      if (result.length === 0) {
        throw new NotFoundError('Photo');
      }

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
}

// Export singleton instance
export const photoRepository = new PhotoRepository(getDb());
