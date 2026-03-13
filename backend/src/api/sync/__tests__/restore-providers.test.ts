/**
 * Unit tests for restore provider list endpoint logic.
 * Validates: Requirement 5.6 — sourceTypes derived from enabled flags + metadata.
 *
 * Tests the pure logic that derives sourceTypes from provider config and
 * filters providers that have at least one available source type.
 */

import { describe, expect, test } from 'bun:test';
import type { BackupConfig, ProviderBackupSettings } from '../../../types';

interface ProviderRow {
  id: string;
  providerType: string;
  displayName: string;
  config: Record<string, unknown> | null;
}

interface RestoreProviderInfo {
  providerId: string;
  providerType: string;
  displayName: string;
  accountEmail: string;
  sourceTypes: ('zip' | 'sheets')[];
}

/**
 * Pure function replicating the restore provider list logic from sync/routes.ts
 * GET /restore/providers handler.
 */
function deriveRestoreProviders(
  providers: ProviderRow[],
  config: BackupConfig
): RestoreProviderInfo[] {
  const result: RestoreProviderInfo[] = [];

  for (const provider of providers) {
    const providerConfig: ProviderBackupSettings | undefined = config.providers[provider.id];
    if (!providerConfig) continue;

    const sourceTypes: ('zip' | 'sheets')[] = [];

    if (providerConfig.enabled && providerConfig.lastBackupAt) {
      sourceTypes.push('zip');
    }
    if (providerConfig.sheetsSyncEnabled && providerConfig.sheetsSpreadsheetId) {
      sourceTypes.push('sheets');
    }

    if (sourceTypes.length === 0) continue;

    result.push({
      providerId: provider.id,
      providerType: provider.providerType,
      displayName: provider.displayName,
      accountEmail: (provider.config?.accountEmail as string) ?? '',
      sourceTypes,
    });
  }

  return result;
}

describe('Restore provider list', () => {
  const providers: ProviderRow[] = [
    {
      id: 'prov-1',
      providerType: 'google-drive',
      displayName: 'Drive 1',
      config: { accountEmail: 'alice@gmail.com' },
    },
    {
      id: 'prov-2',
      providerType: 'google-drive',
      displayName: 'Drive 2',
      config: { accountEmail: 'bob@gmail.com' },
    },
    { id: 'prov-3', providerType: 's3', displayName: 'S3 Bucket', config: null },
  ];

  test('sourceTypes includes zip when enabled=true AND lastBackupAt exists', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          lastBackupAt: '2024-01-01T00:00:00Z',
        },
      },
    };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(1);
    expect(result[0].sourceTypes).toContain('zip');
    expect(result[0].sourceTypes).not.toContain('sheets');
  });

  test('sourceTypes includes sheets when sheetsSyncEnabled=true AND sheetsSpreadsheetId exists', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
          sheetsSpreadsheetId: 'sheet-123',
        },
      },
    };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(1);
    expect(result[0].sourceTypes).toContain('sheets');
    expect(result[0].sourceTypes).not.toContain('zip');
  });

  test('sourceTypes includes both zip and sheets when both are available', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          lastBackupAt: '2024-01-01T00:00:00Z',
          sheetsSyncEnabled: true,
          sheetsSpreadsheetId: 'sheet-123',
        },
      },
    };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(1);
    expect(result[0].sourceTypes).toEqual(['zip', 'sheets']);
  });

  test('provider excluded when enabled but no lastBackupAt', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: true, folderPath: 'Backups', retentionCount: 10 },
      },
    };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(0);
  });

  test('provider excluded when sheetsSyncEnabled but no sheetsSpreadsheetId', () => {
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

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(0);
  });

  test('provider excluded when no config entry exists', () => {
    const config: BackupConfig = { providers: {} };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(0);
  });

  test('multiple providers — each independently evaluated', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          lastBackupAt: '2024-01-01T00:00:00Z',
        },
        'prov-2': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 5,
          sheetsSyncEnabled: true,
          sheetsSpreadsheetId: 'sheet-456',
        },
        'prov-3': { enabled: false, folderPath: 'Backups', retentionCount: 5 },
      },
    };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(2);

    const prov1 = result.find((r) => r.providerId === 'prov-1');
    expect(prov1?.sourceTypes).toEqual(['zip']);
    expect(prov1?.accountEmail).toBe('alice@gmail.com');

    const prov2 = result.find((r) => r.providerId === 'prov-2');
    expect(prov2?.sourceTypes).toEqual(['sheets']);
    expect(prov2?.accountEmail).toBe('bob@gmail.com');
  });

  test('accountEmail defaults to empty string when config is null', () => {
    const config: BackupConfig = {
      providers: {
        'prov-3': {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          lastBackupAt: '2024-01-01T00:00:00Z',
        },
      },
    };

    const result = deriveRestoreProviders(providers, config);
    expect(result).toHaveLength(1);
    expect(result[0].accountEmail).toBe('');
  });
});
