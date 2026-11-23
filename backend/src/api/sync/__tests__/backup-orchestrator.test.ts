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

const DRIVE = 'google-drive';
const driveTypes = new Map([
  ['prov-1', DRIVE],
  ['prov-2', DRIVE],
]);

describe('the shared enabled-provider rule', () => {
  test('a provider is sync-enabled when it has a ZIP backup, a Sheets mirror, or both', () => {
    expect(isSyncEnabled(settings({ enabled: true }), DRIVE)).toBe(true);
    expect(isSyncEnabled(settings({ sheetsSyncEnabled: true }), DRIVE)).toBe(true);
    expect(isSyncEnabled(settings({ enabled: true, sheetsSyncEnabled: true }), DRIVE)).toBe(true);
  });

  test('a provider with neither flag set is not sync-enabled', () => {
    expect(isSyncEnabled(settings(), DRIVE)).toBe(false);
    expect(isSyncEnabled(settings({ sheetsSyncEnabled: false }), DRIVE)).toBe(false);
  });

  test('Sheets sync is strict: only a literal true counts', () => {
    expect(hasSheetsSync(settings())).toBe(false);
    expect(hasSheetsSync(settings({ sheetsSyncEnabled: false }))).toBe(false);
    expect(hasSheetsSync(settings({ sheetsSyncEnabled: true }))).toBe(true);
  });

  test('ZIP backup follows the enabled flag, so a Sheets-only provider has none', () => {
    expect(hasZipBackup(settings({ enabled: true }), DRIVE)).toBe(true);
    expect(hasZipBackup(settings({ enabled: true }), 's3')).toBe(true);
    expect(hasZipBackup(settings({ enabled: false, sheetsSyncEnabled: true }), DRIVE)).toBe(false);
  });

  test('a photo-only provider never takes ZIP backups, even with a stale enabled flag', () => {
    expect(hasZipBackup(settings({ enabled: true }), 'google-photos')).toBe(false);
    expect(isSyncEnabled(settings({ enabled: true }), 'google-photos')).toBe(false);
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
    const enabled = filterEnabledProviders(config, driveTypes);
    expect(enabled).toHaveLength(1);
    expect(needsZipGeneration(enabled, driveTypes)).toBe(false);
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
    expect(needsZipGeneration(filterEnabledProviders(config, driveTypes), driveTypes)).toBe(true);
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
    expect(filterEnabledProviders(config, driveTypes)).toEqual([]);
  });

  test('a stale ZIP entry on a photo-only provider is dropped and needs no ZIP', () => {
    const config: BackupConfig = {
      providers: { 'prov-photos': { enabled: true, folderPath: 'Backups', retentionCount: 10 } },
    };
    const types = new Map([['prov-photos', 'google-photos']]);
    const enabled = filterEnabledProviders(config, types);
    expect(enabled).toEqual([]);
    expect(needsZipGeneration(Object.entries(config.providers), types)).toBe(false);
  });

  test('an empty config selects no providers and needs no ZIP', () => {
    const enabled = filterEnabledProviders({ providers: {} }, driveTypes);
    expect(enabled).toEqual([]);
    expect(needsZipGeneration(enabled, driveTypes)).toBe(false);
  });
});
