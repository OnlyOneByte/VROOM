#!/usr/bin/env bun

import { spawn } from 'bun';

async function runTests() {
  console.log('🧪 Running repository unit tests...\n');

  try {
    // Run all test files
    const testFiles = [
      'src/test/repositories/user.test.ts',
      'src/test/repositories/vehicle.test.ts',
      'src/test/repositories/expense.test.ts',
    ];

    for (const testFile of testFiles) {
      console.log(`Running ${testFile}...`);

      const proc = spawn(['bun', 'test', testFile], {
        stdio: ['inherit', 'inherit', 'inherit'],
      });

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        console.error(`❌ Tests failed in ${testFile}`);
        process.exit(1);
      }

      console.log(`✅ Tests passed in ${testFile}\n`);
    }

    console.log('🎉 All repository tests passed!');
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  await runTests();
}
