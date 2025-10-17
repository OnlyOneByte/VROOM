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

// Configure WAL auto-checkpoint to prevent data loss during hot reload
// Checkpoint after 1000 pages (~4MB) - SQLite default, good balance
// Auto-checkpoint handles most cases, reducing need for manual checkpoints
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
    const result = sqlite.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    } | null;

    // Only log if there was actual work done
    if (result && result.checkpointed > 0) {
      console.log(
        `WAL checkpoint completed: ${result.checkpointed} pages written, ${result.log} pages in WAL`
      );
    }
  } catch (error) {
    console.error('WAL checkpoint failed:', error);
  }
}

// Force immediate checkpoint - useful for critical operations
export function forceCheckpointWAL(): void {
  try {
    // RESTART mode: force checkpoint even if there are readers
    const result = sqlite.query('PRAGMA wal_checkpoint(RESTART)').get() as {
      busy: number;
      log: number;
      checkpointed: number;
    } | null;

    // Only log if there was actual work done
    if (result && result.checkpointed > 0) {
      console.log(`Forced WAL checkpoint completed: ${result.checkpointed} pages written`);
    }
  } catch (error) {
    console.error('Forced WAL checkpoint failed:', error);
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
