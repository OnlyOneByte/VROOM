import type { Column, Table } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { NotFoundError } from '../errors';

/**
 * Common CRUD over a Drizzle table. Subclasses add their own queries with direct Drizzle calls.
 */
export abstract class BaseRepository<T, TNew extends Record<string, unknown>> {
  constructor(
    protected db: AppDatabase,
    protected table: Table & { id: Column }
  ) {}

  async findById(id: string): Promise<T | null> {
    const result = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    return (result[0] as T) || null;
  }

  async create(data: TNew): Promise<T> {
    const result = await this.db.insert(this.table).values(data).returning();
    return result[0] as T;
  }

  async update(id: string, data: Partial<TNew>): Promise<T> {
    // Tables without an updatedAt column are valid targets, so the stamp is conditional.
    const updateData = {
      ...data,
      ...('updatedAt' in this.table ? { updatedAt: new Date() } : {}),
    };

    const result = await this.db
      .update(this.table)
      .set(updateData)
      .where(eq(this.table.id, id))
      .returning();

    if (result.length === 0) {
      throw new NotFoundError('Resource');
    }

    return result[0] as T;
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.delete(this.table).where(eq(this.table.id, id)).returning();

    if (result.length === 0) {
      throw new NotFoundError('Resource');
    }
  }

  // Protected so subclasses expose a typed findIdsBy<Column> that delegates here.
  protected async findIdsByColumn(column: Column, value: unknown): Promise<string[]> {
    // Full rows rather than an id-only projection, because the generic table type does not satisfy
    // a narrower select.
    const rows = await this.db.select().from(this.table).where(eq(column, value));
    return rows.map((r) => (r as { id: string }).id);
  }
}
