#!/usr/bin/env bun

/**
 * Test runner for vehicle management integration tests
 * Run with: bun run test:vehicles
 */

import { spawn } from 'bun';

async function runVehicleTests() {
  console.log('🚗 Running Vehicle Management Integration Tests...\n');

  try {
    const result = await spawn({
      cmd: ['bun', 'test', 'src/test/integration/vehicles.test.ts', '--timeout', '30000'],
      cwd: process.cwd(),
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    if (result.exitCode === 0) {
      console.log('\n✅ All vehicle management tests passed!');
    } else {
      console.log('\n❌ Some vehicle management tests failed.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error running vehicle tests:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  runVehicleTests();
}

export { runVehicleTests };