import { eq } from 'drizzle-orm';
import type { Column, Table } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
import { NotFoundError } from '../errors';

/**
 * Base Repository - Common CRUD Operations
 *
 * ARCHITECTURAL DECISION: Simplified Base Repository
 * ===================================================
 * This base class provides common CRUD operations with consistent error handling.
 * It has been simplified to use direct Drizzle queries without abstraction layers.
 *
 * What was removed:
 * - QueryBuilder abstraction - now uses direct Drizzle queries
 * - Excessive try-catch blocks - errors bubble to global handler
 * - getTableName() helper - not needed without extensive logging
 *
 * What remains:
 * - Core CRUD: findById, create, update, delete
 * - Consistent error handling with typed errors
 * - Essential logging for operations
 *
 * Usage:
 * ```typescript
 * export class UserRepository extends BaseRepository<User, NewUser> {
 *   constructor(db: AppDatabase) {
 *     super(db, users);
 *   }
 *
 *   // Add custom methods with direct Drizzle queries
 *   async findByEmail(email: string): Promise<User | null> {
 *     const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
 *     return result[0] || null;
 *   }
 * }
 * ```
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
    // Only add updatedAt if the table has this column
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
}
