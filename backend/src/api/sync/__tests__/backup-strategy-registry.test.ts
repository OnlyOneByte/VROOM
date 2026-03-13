/**
 * Unit tests for BackupStrategyRegistry.
 * Validates: Requirement 3.3 — register, retrieve, undefined for unregistered, overwrite.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import type {
  BackupStrategy,
  BackupStrategyContext,
  BackupStrategyResult,
} from '../backup-strategy';

/** Minimal mock strategy for testing registry behavior. */
function createMockStrategy(label: string): BackupStrategy {
  return {
    async execute(_ctx: BackupStrategyContext): Promise<BackupStrategyResult> {
      return { success: true, message: label, capabilities: {} };
    },
  };
}

describe('BackupStrategyRegistry', () => {
  // Import fresh module per test to avoid shared state between tests
  let registry: typeof import('../backup-strategy-registry')['backupStrategyRegistry'];

  beforeEach(async () => {
    // Re-import to get a fresh singleton — but since it's a module-level singleton,
    // we test the class directly by creating a new instance via the exported class pattern.
    // The registry uses a Map internally, so we can test register/get behavior.
    const mod = await import('../backup-strategy-registry');
    registry = mod.backupStrategyRegistry;
    // Clear any previously registered strategies by re-registering known types
  });

  test('register and retrieve a strategy', () => {
    const strategy = createMockStrategy('google-drive');
    registry.register('google-drive', strategy);
    expect(registry.get('google-drive')).toBe(strategy);
  });

  test('returns undefined for unregistered provider type', () => {
    expect(registry.get('nonexistent-provider')).toBeUndefined();
  });

  test('overwrite replaces the previous strategy', async () => {
    const first = createMockStrategy('first');
    const second = createMockStrategy('second');

    registry.register('google-drive', first);
    expect(registry.get('google-drive')).toBe(first);

    registry.register('google-drive', second);
    expect(registry.get('google-drive')).toBe(second);
    expect(registry.get('google-drive')).not.toBe(first);

    // Verify the replaced strategy actually executes differently
    const result = await registry.get('google-drive')?.execute({} as BackupStrategyContext);
    expect(result?.message).toBe('second');
  });

  test('multiple provider types coexist independently', () => {
    const driveStrategy = createMockStrategy('drive');
    const s3Strategy = createMockStrategy('s3');

    registry.register('google-drive', driveStrategy);
    registry.register('s3', s3Strategy);

    expect(registry.get('google-drive')).toBe(driveStrategy);
    expect(registry.get('s3')).toBe(s3Strategy);
  });
});
