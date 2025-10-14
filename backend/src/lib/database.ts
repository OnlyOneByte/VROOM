import { db, checkDatabaseHealth, closeDatabaseConnection } from '../db/connection.js';
import { repositoryFactory } from './repositories/index.js';

// Database service class for centralized database operations
export class DatabaseService {
  private static instance: DatabaseService;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Get the Drizzle database instance
  getDatabase() {
    return db;
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
        message: isHealthy ? 'Database is healthy' : 'Database health check failed'
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Database health check error: ${error instanceof Error ? error.message : 'Unknown error'}`
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
  async transaction<T>(callback: (db: typeof db) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(callback);
    } catch (error) {
      console.error('Transaction failed:', error);
      throw new Error(`Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export singleton instance
export const databaseService = DatabaseService.getInstance();

// Database error types
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value?: any
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(
    public readonly resource: string,
    public readonly identifier: string
  ) {
    super(`${resource} with identifier '${identifier}' not found`);
    this.name = 'NotFoundError';
  }
}

// Error handler utility
export function handleDatabaseError(error: unknown, operation: string): never {
  if (error instanceof DatabaseError) {
    throw error;
  }
  
  if (error instanceof Error) {
    throw new DatabaseError(
      `Database operation '${operation}' failed: ${error.message}`,
      operation,
      error
    );
  }
  
  throw new DatabaseError(
    `Database operation '${operation}' failed with unknown error`,
    operation
  );
}

// Validation utilities
export function validateRequired(value: any, fieldName: string): void {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError(`${fieldName} is required`, fieldName, value);
  }
}

export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid email format', 'email', email);
  }
}

export function validatePositiveNumber(value: number, fieldName: string): void {
  if (typeof value !== 'number' || value <= 0) {
    throw new ValidationError(`${fieldName} must be a positive number`, fieldName, value);
  }
}

export function validateYear(year: number): void {
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear + 1) {
    throw new ValidationError('Invalid year', 'year', year);
  }
}