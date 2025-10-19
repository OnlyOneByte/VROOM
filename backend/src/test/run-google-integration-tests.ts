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
import { logger } from '../lib/utils/logger';

logger.test('Running Google Integration Tests...\n');

const result = spawn({
  cmd: ['bun', 'test', 'src/test/integration/google-integration.test.ts', '--run'],
  cwd: process.cwd(),
  stdio: ['inherit', 'inherit', 'inherit'],
});

const exitCode = await result.exited;

if (exitCode === 0) {
  logger.test('All Google integration tests passed!');
  logger.test('Tests covered:');
  logger.test('  📁 Google Drive folder creation and management');
  logger.test('  📊 Google Sheets spreadsheet generation and data accuracy');
  logger.test('  🔄 Bi-directional sync and conflict resolution');
  logger.test('  ⚠️  Error handling and edge cases');
} else {
  logger.error('Some Google integration tests failed.');
  logger.error('Check the output above for details.');
}

process.exit(exitCode);
