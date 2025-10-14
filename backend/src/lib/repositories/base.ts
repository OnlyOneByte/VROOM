import { eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../../db/connection.js';
import type { IBaseRepository } from './interfaces.js';

// Base repository implementation with common CRUD operations
export abstract class BaseRepository<T, TNew> implements IBaseRepository<T, TNew> {
  constructor(protected table: SQLiteTable) {}

  async findById(id: string): Promise<T | null> {
    try {
      const result = await db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
      return result[0] as T || null;
    } catch (error) {
      console.error(`Error finding record by id ${id}:`, error);
      throw new Error(`Failed to find record by id`);
    }
  }

  async create(data: TNew): Promise<T> {
    try {
      const result = await db.insert(this.table).values(data).returning();
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
      
      const result = await db
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
      const result = await db.delete(this.table).where(eq(this.table.id, id)).returning();
      
      if (result.length === 0) {
        throw new Error(`Record with id ${id} not found`);
      }
    } catch (error) {
      console.error(`Error deleting record with id ${id}:`, error);
      throw new Error(`Failed to delete record`);
    }
  }
}