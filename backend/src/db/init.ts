#!/usr/bin/env bun

import { checkDatabaseHealth, runMigrations } from './connection.js';
import { seedDatabase } from './seed.js';

async function initializeDatabase() {
  try {
    console.log('🚀 Initializing VROOM database...');

    // Run migrations
    await runMigrations();

    // Check database health
    const isHealthy = checkDatabaseHealth();
    if (!isHealthy) {
      throw new Error('Database health check failed after migration');
    }

    console.log('✅ Database initialized successfully');

    // Ask if user wants to seed with sample data
    const shouldSeed = process.argv.includes('--seed');

    if (shouldSeed) {
      console.log('🌱 Seeding database with sample data...');
      await seedDatabase();
      console.log('✅ Database seeded successfully');
    } else {
      console.log('💡 To seed with sample data, run: bun src/db/init.ts --seed');
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  await initializeDatabase();
}
