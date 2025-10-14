// Legacy repository interfaces - use ./repositories/index.ts for new implementations
// This file is kept for backward compatibility

// Re-export from the new repository structure
export * from './repositories/index.js';

// Export database service for easy access
export { databaseService, DatabaseService } from './database.js';