// Legacy repository interfaces - use ./repositories/index.ts for new implementations
// This file is kept for backward compatibility

// Export database service for easy access
export { DatabaseService, databaseService } from './database.js';
// Re-export from the new repository structure
export * from './repositories/index.js';
