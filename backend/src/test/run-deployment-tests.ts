#!/usr/bin/env bun

/**
 * Deployment and CI/CD Test Runner
 * Runs all deployment-related tests
 */

import { spawn } from 'bun';

console.log('🚀 Running Deployment and CI/CD Tests\n');

const testFiles = [
  'src/test/deployment/docker.test.ts',
  'src/test/deployment/ci-cd.test.ts',
  'src/test/deployment/portainer.test.ts',
];

let hasErrors = false;

for (const testFile of testFiles) {
  console.log(`\n📋 Running: ${testFile}`);
  console.log('─'.repeat(80));
  
  const proc = spawn(['bun', 'test', testFile], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  
  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    hasErrors = true;
    console.error(`\n❌ Tests failed in ${testFile}`);
  } else {
    console.log(`\n✅ Tests passed in ${testFile}`);
  }
}

console.log('\n' + '='.repeat(80));

if (hasErrors) {
  console.error('\n❌ Some deployment tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All deployment tests passed!');
  process.exit(0);
}
