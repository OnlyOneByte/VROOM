import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from '../core/errors/index.js';
import { logger } from '../utils/logger.js';
import { QueryBuilder } from './query-builder.js';

/**
 * Base Repository - Common CRUD Operations
 *
 * ARCHITECTURAL DECISION: Simplified Base Repository
 * ===================================================
 * This base class provides common CRUD operations with consistent error handling
 * and logging. It has been simplified from the original implementation.
 *
 * What was removed:
 * - Test database hooks (setTestDatabase, etc.) - moved to DatabaseService
 * - Complex factory integration - now uses direct instantiation
 * - Unnecessary abstractions - kept only essential CRUD operations
 *
 * What remains:
 * - Core CRUD: findById, create, update, delete
 * - Consistent error handling with typed errors
 * - Comprehensive logging for all operations
 * - QueryBuilder integration for complex queries
 *
 * Usage:
 * ```typescript
 * export class UserRepository extends BaseRepository<User, NewUser> {
 *   constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
 *     super(db, users);
 *   }
 *
 *   // Add custom methods here
 *   async findByEmail(email: string): Promise<User | null> {
 *     return await this.queryBuilder.findOne(users, eq(users.email, email));
 *   }
 * }
 * ```
 */
export abstract class BaseRepository<T, TNew extends Record<string, unknown>> {
  protected queryBuilder: QueryBuilder<T>;

  constructor(
    protected db: BunSQLiteDatabase<Record<string, unknown>>,
    protected table: SQLiteTable & { id: SQLiteColumn }
  ) {
    this.queryBuilder = new QueryBuilder<T>(db);
  }

  // Helper method to get table name safely
  protected getTableName(): string {
    return (
      (this.table as unknown as { [key: symbol]: string })[Symbol.for('drizzle:Name')] || 'unknown'
    );
  }

  async findById(id: string): Promise<T | null> {
    try {
      return await this.queryBuilder.findOne(this.table, eq(this.table.id, id));
    } catch (error) {
      const tableName = this.getTableName();
      logger.error(`Failed to find ${tableName} by id`, {
        id,
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError(`Failed to find ${tableName} with id ${id}`, error);
    }
  }

  async create(data: TNew): Promise<T> {
    try {
      const result = await this.db.insert(this.table).values(data).returning();
      const created = result[0] as T;
      const tableName = this.getTableName();
      logger.info(`Created ${tableName}`, { id: (created as { id?: string }).id });
      return created;
    } catch (error) {
      const tableName = this.getTableName();
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create ${tableName}`, {
        tableName,
        error: errorMessage,
      });

      // Handle specific SQLite errors
      if (errorMessage.includes('UNIQUE constraint')) {
        throw new ConflictError(`${tableName} already exists with the provided unique field`);
      }

      if (errorMessage.includes('FOREIGN KEY constraint')) {
        throw new ValidationError(`Invalid reference in ${tableName}`);
      }

      if (errorMessage.includes('NOT NULL constraint')) {
        throw new ValidationError(`Missing required field in ${tableName}`);
      }

      throw new DatabaseError(`Failed to create ${tableName}`, error);
    }
  }

  async update(id: string, data: Partial<TNew>): Promise<T> {
    const tableName = this.getTableName();
    try {
      const updateData = {
        ...data,
        updatedAt: new Date(),
      };

      const result = await this.db
        .update(this.table)
        .set(updateData)
        .where(eq(this.table.id, id))
        .returning();

      if (result.length === 0) {
        logger.warn(`${tableName} not found for update`, { id, tableName });
        throw new NotFoundError(tableName);
      }

      logger.info(`Updated ${tableName}`, { id, tableName });
      return result[0] as T;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to update ${tableName}`, {
        id,
        tableName,
        error: errorMessage,
      });

      // Handle specific SQLite errors
      if (errorMessage.includes('UNIQUE constraint')) {
        throw new ConflictError(`${tableName} already exists with the provided unique field`);
      }

      if (errorMessage.includes('FOREIGN KEY constraint')) {
        throw new ValidationError(`Invalid reference in ${tableName}`);
      }

      throw new DatabaseError(`Failed to update ${tableName} with id ${id}`, error);
    }
  }

  async delete(id: string): Promise<void> {
    const tableName = this.getTableName();
    try {
      const result = await this.db.delete(this.table).where(eq(this.table.id, id)).returning();

      if (result.length === 0) {
        logger.warn(`${tableName} not found for deletion`, { id, tableName });
        throw new NotFoundError(tableName);
      }

      logger.info(`Deleted ${tableName}`, { id, tableName });
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete ${tableName}`, {
        id,
        tableName,
        error: errorMessage,
      });

      // Handle specific SQLite errors
      if (errorMessage.includes('FOREIGN KEY constraint')) {
        throw new ConflictError(
          `Cannot delete ${tableName} because it is referenced by other records`
        );
      }

      throw new DatabaseError(`Failed to delete ${tableName} with id ${id}`, error);
    }
  }
}
