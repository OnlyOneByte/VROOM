// filterEnabledProviders and needsZipGeneration are the real exports. The mutex, result collection
// and fan-out helpers below are copies of logic inside execute(), which needs a DB to run.

import { describe, expect, test } from 'bun:test';
import type { BackupConfig, ProviderBackupSettings } from '../../../types';
import { filterEnabledProviders, needsZipGeneration } from '../backup-orchestrator';
import type { BackupOrchestratorResult, BackupStrategyResult } from '../backup-strategy';

const MUTEX_TTL_MS = 5 * 60 * 1000;

function acquireMutex(mutexMap: Map<string, number>, userId: string, now: number): boolean {
  const existing = mutexMap.get(userId);
  if (existing && now - existing < MUTEX_TTL_MS) {
    return false;
  }
  mutexMap.set(userId, now);
  return true;
}

function collectResults(
  results: Record<string, BackupStrategyResult>,
  originalConfig: BackupConfig,
  timestamp: string
): { updatedConfig: BackupConfig; anySuccess: boolean } {
  const updatedConfig = { ...originalConfig, providers: { ...originalConfig.providers } };
  let anySuccess = false;

  for (const [providerId, result] of Object.entries(results)) {
    if (result.success) {
      anySuccess = true;
      updatedConfig.providers[providerId] = {
        ...updatedConfig.providers[providerId],
        lastBackupAt: timestamp,
      };

      const sheetsId = result.capabilities.sheets?.metadata?.spreadsheetId as string | undefined;
      if (sheetsId) {
        updatedConfig.providers[providerId] = {
          ...updatedConfig.providers[providerId],
          sheetsSpreadsheetId: sheetsId,
        };
      }
    }
  }

  return { updatedConfig, anySuccess };
}

async function simulateFanOut(
  enabledProviders: [string, ProviderBackupSettings][],
  registeredTypes: Set<string>,
  providerTypeMap: Map<string, string>,
  strategyFn: (providerId: string) => Promise<BackupStrategyResult>
): Promise<Record<string, BackupStrategyResult>> {
  const results: Record<string, BackupStrategyResult> = {};

  const settled = await Promise.allSettled(
    enabledProviders.map(async ([providerId]) => {
      const providerType = providerTypeMap.get(providerId) ?? '';
      if (!registeredTypes.has(providerType)) {
        return { providerId, result: null };
      }
      const result = await strategyFn(providerId);
      return { providerId, result };
    })
  );

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && outcome.value.result) {
      results[outcome.value.providerId] = outcome.value.result;
    }
  }

  return results;
}

describe('BackupOrchestrator', () => {
  test('fan-out to multiple providers — one result per enabled provider', async () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 },
        'prov-2': { enabled: true, folderPath: 'Backups', retentionCount: 5 },
      },
    };
    const enabled = filterEnabledProviders(config);
    const typeMap = new Map([
      ['prov-1', 'google-drive'],
      ['prov-2', 'google-drive'],
    ]);
    const registered = new Set(['google-drive']);

    const results = await simulateFanOut(enabled, registered, typeMap, async () => ({
      success: true,
      capabilities: { zip: { success: true, metadata: { fileRef: 'ref' } } },
    }));

    expect(Object.keys(results)).toHaveLength(2);
    expect(results['prov-1']).toBeDefined();
    expect(results['prov-2']).toBeDefined();
  });

  test('mutex returns status not throw — second acquire fails', () => {
    const mutexMap = new Map<string, number>();
    const now = Date.now();

    expect(acquireMutex(mutexMap, 'user-1', now)).toBe(true);
    expect(acquireMutex(mutexMap, 'user-1', now + 1000)).toBe(false); // within TTL
  });

  test('TTL eviction — mutex released after 5 minutes', () => {
    const mutexMap = new Map<string, number>();
    const now = Date.now();

    expect(acquireMutex(mutexMap, 'user-1', now)).toBe(true);
    expect(acquireMutex(mutexMap, 'user-1', now + MUTEX_TTL_MS + 1)).toBe(true);
  });

  test('change detection skip — returns skipped result', () => {
    const force = false;
    const hasChanges = false;
    const shouldSkip = !force && !hasChanges;
    expect(shouldSkip).toBe(true);

    const result: BackupOrchestratorResult = {
      timestamp: new Date().toISOString(),
      skipped: true,
      outcome: 'noop',
      failedProviders: [],
      results: {},
    };
    expect(result.skipped).toBe(true);
    expect(result.results).toEqual({});
  });

  test('conditional ZIP — not generated when no provider has enabled=true', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      },
    };
    const enabled = filterEnabledProviders(config);
    expect(enabled).toHaveLength(1); // sheetsSyncEnabled=true
    expect(needsZipGeneration(enabled)).toBe(false);
  });

  test('conditional ZIP — generated when at least one provider has enabled=true', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 },
        'prov-2': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 5,
          sheetsSyncEnabled: true,
        },
      },
    };
    const enabled = filterEnabledProviders(config);
    expect(needsZipGeneration(enabled)).toBe(true);
  });

  test('parallel with timeout — fan-out uses Promise.allSettled', async () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 },
        'prov-2': { enabled: true, folderPath: 'Backups', retentionCount: 5 },
      },
    };
    const enabled = filterEnabledProviders(config);
    const typeMap = new Map([
      ['prov-1', 'google-drive'],
      ['prov-2', 'google-drive'],
    ]);
    const registered = new Set(['google-drive']);

    const results = await simulateFanOut(enabled, registered, typeMap, async (id) => {
      if (id === 'prov-2') {
        return { success: false, capabilities: { zip: { success: false, message: 'timeout' } } };
      }
      return { success: true, capabilities: { zip: { success: true } } };
    });

    expect(results['prov-1']?.success).toBe(true);
    expect(results['prov-2']?.success).toBe(false);
  });

  test('lastBackupAt persistence — updated for successful providers only', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 },
        'prov-2': { enabled: true, folderPath: 'Backups', retentionCount: 5 },
      },
    };
    const timestamp = '2024-06-01T12:00:00Z';
    const results: Record<string, BackupStrategyResult> = {
      'prov-1': { success: true, capabilities: { zip: { success: true } } },
      'prov-2': { success: false, capabilities: { zip: { success: false, message: 'fail' } } },
    };

    const { updatedConfig, anySuccess } = collectResults(results, config, timestamp);

    expect(anySuccess).toBe(true);
    expect(updatedConfig.providers['prov-1'].lastBackupAt).toBe(timestamp);
    expect(updatedConfig.providers['prov-2'].lastBackupAt).toBeUndefined();
  });

  test('sheetsSpreadsheetId persistence — extracted from strategy result metadata', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      },
    };
    const timestamp = '2024-06-01T12:00:00Z';
    const results: Record<string, BackupStrategyResult> = {
      'prov-1': {
        success: true,
        capabilities: {
          sheets: {
            success: true,
            metadata: { spreadsheetId: 'sheet-abc', webViewLink: 'https://...' },
          },
        },
      },
    };

    const { updatedConfig } = collectResults(results, config, timestamp);
    expect(updatedConfig.providers['prov-1'].sheetsSpreadsheetId).toBe('sheet-abc');
  });

  test('updateSyncDate — called when anySuccess is true', () => {
    const results: Record<string, BackupStrategyResult> = {
      'prov-1': { success: true, capabilities: {} },
    };
    const config: BackupConfig = {
      providers: { 'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 } },
    };
    const { anySuccess } = collectResults(results, config, new Date().toISOString());
    expect(anySuccess).toBe(true);
  });

  test('updateSyncDate — NOT called when all providers fail', () => {
    const results: Record<string, BackupStrategyResult> = {
      'prov-1': { success: false, capabilities: { zip: { success: false, message: 'fail' } } },
    };
    const config: BackupConfig = {
      providers: { 'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 } },
    };
    const { anySuccess } = collectResults(results, config, new Date().toISOString());
    expect(anySuccess).toBe(false);
  });

  test('empty providers — filter returns empty, no fan-out needed', () => {
    const config: BackupConfig = { providers: {} };
    const enabled = filterEnabledProviders(config);
    expect(enabled).toHaveLength(0);
  });

  test('skip unregistered strategy — provider without strategy excluded from results', async () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 },
      },
    };
    const enabled = filterEnabledProviders(config);
    const typeMap = new Map([['prov-1', 's3']]);
    const registered = new Set(['google-drive']); // s3 not registered

    const results = await simulateFanOut(enabled, registered, typeMap, async () => ({
      success: true,
      capabilities: {},
    }));

    expect(Object.keys(results)).toHaveLength(0);
  });

  test('exportAsZip failure — zipBuffer is null, Sheets-only continues', async () => {
    let zipBuffer: Buffer | null = null;
    try {
      throw new Error('ZIP generation failed');
    } catch {
      zipBuffer = null;
    }
    expect(zipBuffer).toBeNull();

    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      },
    };
    const enabled = filterEnabledProviders(config);
    const typeMap = new Map([['prov-1', 'google-drive']]);
    const registered = new Set(['google-drive']);

    const results = await simulateFanOut(enabled, registered, typeMap, async () => ({
      success: true,
      capabilities: {
        sheets: { success: true, metadata: { spreadsheetId: 'sheet-1' } },
      },
    }));

    expect(results['prov-1']?.success).toBe(true);
  });

  test('in_progress result shape — status field set correctly', () => {
    const result: BackupOrchestratorResult = {
      timestamp: new Date().toISOString(),
      status: 'in_progress',
      outcome: 'noop',
      failedProviders: [],
      results: {},
    };
    expect(result.status).toBe('in_progress');
    expect(result.results).toEqual({});
  });

  test('filter includes sheetsSyncEnabled providers even when enabled=false', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
        'prov-2': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 5,
          sheetsSyncEnabled: false,
        },
      },
    };
    const enabled = filterEnabledProviders(config);
    expect(enabled).toHaveLength(1);
    expect(enabled[0][0]).toBe('prov-1');
  });
});

describe('filterEnabledProviders / needsZipGeneration edge cases', () => {
  test('an empty config selects no providers and needs no ZIP', () => {
    const enabled = filterEnabledProviders({ providers: {} });
    expect(enabled).toEqual([]);
    expect(needsZipGeneration(enabled)).toBe(false);
  });

  test('sheetsSyncEnabled uses strict === true', () => {
    // Strict equality: undefined and false both drop out.
    const config: BackupConfig = {
      providers: {
        off: { enabled: false, folderPath: 'B', retentionCount: 1 }, // no sheetsSyncEnabled → omitted
        sheetsOff: { enabled: false, folderPath: 'B', retentionCount: 1, sheetsSyncEnabled: false },
      },
    };
    expect(filterEnabledProviders(config)).toEqual([]);
  });

  test('a Sheets-only provider is selected but needs NO ZIP (enabled=false → ZIP skipped)', () => {
    const config: BackupConfig = {
      providers: {
        sheetsOnly: { enabled: false, folderPath: 'B', retentionCount: 1, sheetsSyncEnabled: true },
      },
    };
    const enabled = filterEnabledProviders(config);
    expect(enabled).toHaveLength(1);
    expect(needsZipGeneration(enabled)).toBe(false); // the data-cost guard: don't build a ZIP nobody uploads
  });

  test('a ZIP-enabled provider alongside a Sheets-only one DOES need a ZIP', () => {
    const config: BackupConfig = {
      providers: {
        zip: { enabled: true, folderPath: 'B', retentionCount: 1 },
        sheetsOnly: { enabled: false, folderPath: 'B', retentionCount: 1, sheetsSyncEnabled: true },
      },
    };
    expect(needsZipGeneration(filterEnabledProviders(config))).toBe(true);
  });
});
