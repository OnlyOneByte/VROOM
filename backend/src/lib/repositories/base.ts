import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../../db/connection.js';
import type { IBaseRepository } from './interfaces.js';

// Base repository implementation with common CRUD operations
export abstract class BaseRepository<T, TNew extends Record<string, unknown>>
  implements IBaseRepository<T, TNew>
{
  // Static database instance for testing
  private static testDb: BunSQLiteDatabase<Record<string, unknown>> | null = null;

  constructor(protected table: SQLiteTable & { id: SQLiteColumn }) {}

  // Get the database instance (test or production)
  protected get database() {
    return BaseRepository.testDb || db;
  }

  // Static method to set test database instance
  static setDatabaseInstance(testDatabase: BunSQLiteDatabase<Record<string, unknown>>) {
    BaseRepository.testDb = testDatabase;
  }

  // Static method to reset to production database
  static resetDatabaseInstance() {
    BaseRepository.testDb = null;
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
      console.error(`Error finding record by id ${id}:`, error);
      throw new Error(`Failed to find record by id`);
    }
  }

  async create(data: TNew): Promise<T> {
    try {
      const result = await this.database.insert(this.table).values(data).returning();
      return result[0] as T;
    } catch (error) {
      console.error(`Error creating record:`, error);
      throw new Error(`Failed to create record`);
    }
  }

  async update(id: string, data: Partial<TNew>): Promise<T> {
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
        throw new Error(`Record with id ${id} not found`);
      }

      return result[0] as T;
    } catch (error) {
      console.error(`Error updating record with id ${id}:`, error);
      throw new Error(`Failed to update record`);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const result = await this.database
        .delete(this.table)
        .where(eq(this.table.id, id))
        .returning();

      if (result.length === 0) {
        throw new Error(`Record with id ${id} not found`);
      }
    } catch (error) {
      console.error(`Error deleting record with id ${id}:`, error);
      throw new Error(`Failed to delete record`);
    }
  }
}
