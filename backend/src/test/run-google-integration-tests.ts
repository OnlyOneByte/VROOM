#!/usr/bin/env bun

/**
 * Test runner for Google integration tests
 *
 * This script runs the Google Drive and Sheets integration tests
 * which verify:
 * - Google Drive folder creation and management
 * - Google Sheets spreadsheet generation and data accuracy
 * - Bi-directional sync and conflict resolution
 * - Error handling and edge cases
 *
 * Usage:
 *   bun run src/test/run-google-integration-tests.ts
 */

import { spawn } from 'bun';

console.log('🚀 Running Google Integration Tests...\n');

const result = spawn({
  cmd: ['bun', 'test', 'src/test/integration/google-integration.test.ts', '--run'],
  cwd: process.cwd(),
  stdio: ['inherit', 'inherit', 'inherit'],
});

const exitCode = await result.exited;

if (exitCode === 0) {
  console.log('\n✅ All Google integration tests passed!');
  console.log('\nTests covered:');
  console.log('  📁 Google Drive folder creation and management');
  console.log('  📊 Google Sheets spreadsheet generation and data accuracy');
  console.log('  🔄 Bi-directional sync and conflict resolution');
  console.log('  ⚠️  Error handling and edge cases');
} else {
  console.log('\n❌ Some Google integration tests failed.');
  console.log('Check the output above for details.');
}

process.exit(exitCode);
