// The provider selection rules, against the real exports. Run-level behavior (mutex, fan-out,
// outcome aggregation, result persistence) needs the DB and is covered against the real execute()
// in backup-orchestrator-execute.test.ts.

import { describe, expect, test } from 'bun:test';
import type { BackupConfig, ProviderBackupSettings } from '../../../types';
import { filterEnabledProviders, needsZipGeneration } from '../backup-orchestrator';
import { hasSheetsSync, hasZipBackup, isSyncEnabled } from '../backup-strategy';

const settings = (overrides: Partial<ProviderBackupSettings> = {}): ProviderBackupSettings => ({
  enabled: false,
  folderPath: 'B',
  retentionCount: 5,
  ...overrides,
});

describe('the shared enabled-provider rule', () => {
  test('a provider is sync-enabled when it has a ZIP backup, a Sheets mirror, or both', () => {
    expect(isSyncEnabled(settings({ enabled: true }))).toBe(true);
    expect(isSyncEnabled(settings({ sheetsSyncEnabled: true }))).toBe(true);
    expect(isSyncEnabled(settings({ enabled: true, sheetsSyncEnabled: true }))).toBe(true);
  });

  test('a provider with neither flag set is not sync-enabled', () => {
    expect(isSyncEnabled(settings())).toBe(false);
    expect(isSyncEnabled(settings({ sheetsSyncEnabled: false }))).toBe(false);
  });

  test('Sheets sync is strict: only a literal true counts', () => {
    expect(hasSheetsSync(settings())).toBe(false);
    expect(hasSheetsSync(settings({ sheetsSyncEnabled: false }))).toBe(false);
    expect(hasSheetsSync(settings({ sheetsSyncEnabled: true }))).toBe(true);
  });

  test('ZIP backup follows the enabled flag alone, so a Sheets-only provider has none', () => {
    expect(hasZipBackup(settings({ enabled: true }))).toBe(true);
    expect(hasZipBackup(settings({ enabled: false, sheetsSyncEnabled: true }))).toBe(false);
  });
});

describe('filterEnabledProviders / needsZipGeneration', () => {
  test('a Sheets-only provider is selected but needs no ZIP', () => {
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
    expect(enabled).toHaveLength(1);
    expect(needsZipGeneration(enabled)).toBe(false); // the data-cost guard: don't build a ZIP nobody uploads
  });

  test('a ZIP-enabled provider alongside a Sheets-only one needs a ZIP', () => {
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
    expect(needsZipGeneration(filterEnabledProviders(config))).toBe(true);
  });

  test('providers with neither flag are dropped', () => {
    const config: BackupConfig = {
      providers: {
        'prov-1': { enabled: false, folderPath: 'Backups', retentionCount: 10 },
        'prov-2': {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 5,
          sheetsSyncEnabled: false,
        },
      },
    };
    expect(filterEnabledProviders(config)).toEqual([]);
  });

  test('an empty config selects no providers and needs no ZIP', () => {
    const enabled = filterEnabledProviders({ providers: {} });
    expect(enabled).toEqual([]);
    expect(needsZipGeneration(enabled)).toBe(false);
  });
});
