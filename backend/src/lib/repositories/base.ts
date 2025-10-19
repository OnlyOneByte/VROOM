import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';
import { TYPES } from '../di/types.js';
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '../errors.js';
import { logger } from '../utils/logger.js';
import type { IBaseRepository } from './interfaces.js';

// Base repository implementation with common CRUD operations
@injectable()
export abstract class BaseRepository<T, TNew extends Record<string, unknown>>
  implements IBaseRepository<T, TNew>
{
  // Static database instance for testing (backward compatibility)
  private static testDb: BunSQLiteDatabase<Record<string, unknown>> | null = null;

  constructor(
    @inject(TYPES.Database) protected db: BunSQLiteDatabase<Record<string, unknown>>,
    protected table: SQLiteTable & { id: SQLiteColumn }
  ) {}

  // Get the database instance (test or production)
  protected get database() {
    return BaseRepository.testDb || this.db;
  }

  // Static method to set test database instance (backward compatibility)
  static setDatabaseInstance(testDatabase: BunSQLiteDatabase<Record<string, unknown>>) {
    BaseRepository.testDb = testDatabase;
  }

  // Static method to reset to production database (backward compatibility)
  static resetDatabaseInstance() {
    BaseRepository.testDb = null;
  }

  // Helper method to get table name safely
  protected getTableName(): string {
    return (
      (this.table as unknown as { [key: symbol]: string })[Symbol.for('drizzle:Name')] || 'unknown'
    );
  }

  async findById(id: string): Promise<T | null> {
    try {
      const result = await this.database
        .select()
        .from(this.table)
        .where(eq(this.table.id, id))
        .limit(1);
      return (result[0] as T) || null;
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
      const result = await this.database.insert(this.table).values(data).returning();
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

      const result = await this.database
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
      const result = await this.database
        .delete(this.table)
        .where(eq(this.table.id, id))
        .returning();

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
