import type { Column, Table } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
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

  /**
   * IDs of all rows on this table where `column === value`. The select-id-and-map body was
   * hand-rolled identically in ExpenseRepository.findIdsByVehicleId + OdometerRepository.
   * findIdsByVehicleId (both back the vehicle-delete photo-cascade cleanup); one source of truth here.
   * Protected (not public) — repositories expose a named, typed `findIdsBy<Column>` that delegates,
   * keeping the call-site contract while sharing the query body.
   */
  protected async findIdsByColumn(column: Column, value: unknown): Promise<string[]> {
    // Select full rows (like findById) rather than an id-only projection — the generic `this.table.id`
    // doesn't satisfy the strict select-field type, and these callers (photo-cascade cleanup over a
    // single vehicle's children) are small bounded sets, so the row width is immaterial.
    const rows = await this.db.select().from(this.table).where(eq(column, value));
    return rows.map((r) => (r as { id: string }).id);
  }
}
