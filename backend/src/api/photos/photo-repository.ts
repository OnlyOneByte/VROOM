import { and, asc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb, transaction } from '../../db/connection';
import { type NewPhoto, type Photo, photos } from '../../db/schema';
import { NotFoundError } from '../../errors';
import type { PaginatedResult } from '../../utils/pagination';

/**
 * Generic PhotoRepository — entity-agnostic data access for the photos table.
 *
 * v2: photos carry a direct user_id FK. User-scoped queries use WHERE user_id = ?
 * directly instead of multi-branch entity JOINs.
 */
export class PhotoRepository {
  constructor(private db: AppDatabase) {}

  /**
   * Find all photos belonging to a user, optionally filtered by entity type.
   * Uses the direct user_id column instead of JOINing through entity tables.
   */
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

  /**
   * Count photos belonging to a user, optionally filtered by entity type.
   * Uses the direct user_id column instead of JOINing through entity tables.
   */
  async countByUser(userId: string, entityType?: string): Promise<number> {
    const conditions = [eq(photos.userId, userId)];
    if (entityType) {
      conditions.push(eq(photos.entityType, entityType));
    }
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(photos)
      .where(and(...conditions));
    return result?.count ?? 0;
  }

  /**
   * Find photo IDs belonging to a user, optionally filtered by entity type.
   * Uses the direct user_id column instead of JOINing through entity tables.
   */
  async findIdsByUser(
    userId: string,
    entityType?: string,
    extraConditions?: ReturnType<typeof and>
  ): Promise<string[]> {
    const conditions = [eq(photos.userId, userId)];
    if (entityType) {
      conditions.push(eq(photos.entityType, entityType));
    }
    if (extraConditions) {
      conditions.push(extraConditions);
    }
    const rows = await this.db
      .select({ id: photos.id })
      .from(photos)
      .where(and(...conditions));
    return rows.map((r) => r.id);
  }

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
