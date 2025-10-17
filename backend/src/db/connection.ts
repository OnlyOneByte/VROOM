import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from './schema.js';

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL || './data/vroom.db';

// Ensure data directory exists
const dbDir = dirname(DATABASE_URL);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create SQLite connection
const sqlite = new Database(DATABASE_URL);

// Enable WAL mode for better performance
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA synchronous = NORMAL');
sqlite.run('PRAGMA cache_size = 1000000');
sqlite.run('PRAGMA foreign_keys = ON');
sqlite.run('PRAGMA temp_store = MEMORY');

// Configure WAL auto-checkpoint to prevent data loss
// Checkpoint after 1000 pages (~4MB) to ensure data is persisted
sqlite.run('PRAGMA wal_autocheckpoint = 1000');

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Migration function
export async function runMigrations() {
  try {
    console.log('Running database migrations...');
    migrate(db, { migrationsFolder: './drizzle' });
    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Database health check
export function checkDatabaseHealth(): boolean {
  try {
    const result = sqlite.query('SELECT 1 as health').get() as { health: number } | null;
    return result?.health === 1;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

// Checkpoint WAL to persist data to main database file
export function checkpointWAL(): void {
  try {
    // TRUNCATE mode: checkpoint and truncate WAL file
    sqlite.run('PRAGMA wal_checkpoint(TRUNCATE)');
    console.log('WAL checkpoint completed successfully');
  } catch (error) {
    console.error('WAL checkpoint failed:', error);
  }
}

// Graceful shutdown
export function closeDatabaseConnection() {
  try {
    sqlite.close();
    console.log('Database connection closed');
  } catch (error) {
    console.error('Error closing database connection:', error);
  }
}

// Export the sqlite instance for direct access if needed
export { sqlite };
