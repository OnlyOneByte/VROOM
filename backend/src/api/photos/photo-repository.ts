import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { type NewPhoto, type Photo, photos } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { chunk } from '../../utils/chunk';
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

  /**
   * Find all photos for many entities of one type (e.g. every expense of a
   * vehicle being deleted). Batches the IN clause to stay under SQLite's
   * variable limit. Returns [] for an empty id list.
   */
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
    // userId-scope the WHERE (the C168/#48 + C180 + C192 tenant-scope-at-the-read class): this was the
    // lone photo read-method not scoped by user_id, even though photos carries that column and every
    // sibling (findByUser/countByUser/findIdsByUser) filters on it. Behavior-identical today — the route's
    // validateEntityOwnership proves ownership before this runs — but it closes the boundary at the query
    // so a future caller that forgets the guard can't page another tenant's photos (#72).
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
    // Use this.db.transaction (the sibling-repo convention — expenses/insurance all do) rather than
    // the module-level transaction() helper, which binds the getDb() singleton and ignored the
    // injected this.db (production has this.db === getDb(), so behavior-preserving — but it makes the
    // method respect a test-injected DB AND lets the internal NotFoundError propagate as a 404 instead
    // of being wrapped into a 500 DatabaseError).
    return this.db.transaction(async (tx) => {
      // Validate the target photo belongs to THIS entity BEFORE any write. Two reasons:
      // (1) the C63/#192 + C72/#215 "write keyed on id alone, match proven a layer up" class — a
      //     photoId from a DIFFERENT entity must never be flagged as this entity's cover; and
      // (2) the bun:sqlite ASYNC-transaction footgun (the C151 lesson): a throw escaping this async
      //     callback AFTER a sync write does NOT roll the write back, so validating BEFORE the unset
      //     is what actually guarantees we never leave the entity cover-less on a bad id (an
      //     unset-then-throw would persist the unset).
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

      // Unset all covers for this entity (only reached once the target is proven valid)
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

  /** Delete all photo rows for many entities of one type. Batched for SQLite. */
  async deleteByEntities(entityType: string, entityIds: string[]): Promise<void> {
    if (entityIds.length === 0) return;
    for (const batch of chunk(entityIds)) {
      await this.db
        .delete(photos)
        .where(and(eq(photos.entityType, entityType), inArray(photos.entityId, batch)));
    }
  }
}

// Export singleton instance
export const photoRepository = new PhotoRepository(getDb());
