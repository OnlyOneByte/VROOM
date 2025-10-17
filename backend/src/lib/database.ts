// Database service class for centralized database operations
export class DatabaseService {
  private static instance: DatabaseService;
  private testDatabase: typeof db | null = null;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Set test database instance (for testing only)
  setTestDatabase(testDb: typeof db | null) {
    this.testDatabase = testDb;
  }

  // Get the Drizzle database instance
  getDatabase() {
    return this.testDatabase || db;
  }

  // Get repository factory
  getRepositories() {
    return repositoryFactory;
  }

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const isHealthy = checkDatabaseHealth();
      return {
        healthy: isHealthy,
        message: isHealthy ? 'Database is healthy' : 'Database health check failed',
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Database health check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Graceful shutdown
  async shutdown(): Promise<void> {
    try {
      closeDatabaseConnection();
      console.log('Database service shutdown completed');
    } catch (error) {
      console.error('Error during database service shutdown:', error);
      throw error;
    }
  }

  // Transaction wrapper for complex operations
  async transaction<T>(
    callback: (
      tx: Parameters<typeof db.transaction>[0] extends (tx: infer U) => unknown ? U : never
    ) => Promise<T>
  ): Promise<T> {
    try {
      return await db.transaction(callback);
    } catch (error) {
      console.error('Transaction failed:', error);
      throw new Error(
        `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Export singleton instance
export const databaseService = DatabaseService.getInstance();

import { checkDatabaseHealth, closeDatabaseConnection, db } from '../db/connection.js';
// Import for use in validation functions
import { ValidationError } from './errors.js';
import { repositoryFactory } from './repositories/index.js';

// Re-export error classes from centralized location
export { DatabaseError, NotFoundError, ValidationError } from './errors.js';

// Validation utilities - use Zod schemas instead for better type safety
// These are kept for backward compatibility but should be migrated to Zod
export function validateRequired(value: unknown, fieldName: string): void {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError(`${fieldName} is required`);
  }
}

export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid email format');
  }
}

export function validatePositiveNumber(value: number, fieldName: string): void {
  if (typeof value !== 'number' || value <= 0) {
    throw new ValidationError(`${fieldName} must be a positive number`);
  }
}

export function validateYear(year: number): void {
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear + 1) {
    throw new ValidationError('Invalid year');
  }
}
