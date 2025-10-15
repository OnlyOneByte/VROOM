#!/usr/bin/env bun

/**
 * Authentication Integration Test Runner
 *
 * This script runs the authentication integration tests for the VROOM backend.
 * It ensures the database is properly initialized before running tests.
 */

import { databaseService } from '../lib/database';

async function runAuthTests() {
  console.log('🧪 Starting Authentication Integration Tests...\n');

  try {
    // Check database health
    console.log('📊 Checking database connection...');
    const healthCheck = await databaseService.healthCheck();

    if (!healthCheck.healthy) {
      console.error('❌ Database health check failed:', healthCheck.message);
      process.exit(1);
    }

    console.log('✅ Database connection healthy\n');

    // Run the tests using Bun's test runner
    console.log('🚀 Running authentication tests...\n');

    const testProcess = Bun.spawn(
      [
        'bun',
        'test',
        'src/test/integration/auth.test.ts',
        '--timeout',
        '30000', // 30 second timeout
      ],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
        cwd: process.cwd(),
      }
    );

    const exitCode = await testProcess.exited;

    if (exitCode === 0) {
      console.log('\n✅ All authentication tests passed!');
    } else {
      console.log('\n❌ Some authentication tests failed');
      process.exit(exitCode);
    }
  } catch (error) {
    console.error('❌ Error running authentication tests:', error);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (import.meta.main) {
  runAuthTests();
}
