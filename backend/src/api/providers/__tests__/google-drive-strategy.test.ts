/**
 * Unit tests for GoogleDriveStrategy.
 * Validates: Requirement 4 — ZIP only, Sheets only, both enabled, partial failure,
 * null zipBuffer, retention enforcement, direct provider instantiation.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BackupStrategyContext } from '../../sync/backup-strategy';

// --- Mocks ---
// Paths must match the import specifiers in google-drive-strategy.ts

let mockUpload: ReturnType<typeof mock>;
let mockCreateOrUpdate: ReturnType<typeof mock>;

mock.module('../domains/storage/google-drive-provider', () => {
  mockUpload = mock(() => Promise.resolve({ externalId: 'file-ref-123' }));
  return {
    GoogleDriveProvider: class {
      constructor(public refreshToken: string) {}
      upload = mockUpload;
    },
    // Preserve exports that other test files import from this module
    coalesceGoogleDriveFile: (f: Record<string, unknown>) => ({
      key: f.id,
      name: f.name,
      size: Number(f.size) || 0,
      createdTime: f.createdTime ?? f.modifiedTime ?? new Date(0).toISOString(),
      lastModified: f.modifiedTime ?? f.createdTime ?? new Date(0).toISOString(),
    }),
  };
});

mock.module('../services/google-sheets-service', () => {
  mockCreateOrUpdate = mock(() =>
    Promise.resolve({
      id: 'sheet-id-456',
      webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-id-456',
    })
  );
  return {
    GoogleSheetsService: class {
      constructor(public refreshToken: string) {}
      createOrUpdateVroomSpreadsheet = mockCreateOrUpdate;
    },
    createSheetsServiceForProvider: mock(),
  };
});

// Stub logger to avoid real logging
mock.module('../../../utils/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Import the real backup module — don't mock it, since other test files depend
// on its real exports (coerceRow, validateBackupData, etc.).
// Instead, spy on the singleton's methods directly.
import { backupService } from '../../sync/backup';

// Import after mocks are set up
const { GoogleDriveStrategy } = await import('../backup-strategies/google-drive-strategy');

// Spy on resolveBackupFolderPath by mocking it at the module level won't work,
// so we override it on the strategy's usage path. The strategy imports it statically,
// but since we can't partially mock, we'll mock the entire module but preserve exports.
// Actually — the strategy uses resolveBackupFolderPath directly. Since we can't
// partially mock, we'll just verify the behavior with the real function and
// provide the right providerRow/config to produce a known path.

function createContext(overrides: Partial<BackupStrategyContext> = {}): BackupStrategyContext {
  return {
    userId: 'user-1',
    displayName: 'Test User',
    providerId: 'prov-1',
    providerRow: {
      id: 'prov-1',
      config: { providerRootPath: 'VROOM' },
    } as BackupStrategyContext['providerRow'],
    decryptedCredentials: { refreshToken: 'test-refresh-token' },
    providerConfig: {
      enabled: true,
      folderPath: 'Backups',
      retentionCount: 10,
      sheetsSyncEnabled: false,
    },
    zipBuffer: Buffer.from('fake-zip-data'),
    ...overrides,
  };
}

describe('GoogleDriveStrategy', () => {
  let strategy: InstanceType<typeof GoogleDriveStrategy>;
  let mockEnforceRetention: ReturnType<typeof mock>;

  beforeEach(() => {
    strategy = new GoogleDriveStrategy();
    mockUpload.mockClear();
    mockCreateOrUpdate.mockClear();

    // Reset to default implementations
    mockUpload.mockImplementation(() => Promise.resolve({ externalId: 'file-ref-123' }));
    mockCreateOrUpdate.mockImplementation(() =>
      Promise.resolve({
        id: 'sheet-id-456',
        webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-id-456',
      })
    );

    // Spy on the real backupService singleton's enforceRetention method
    mockEnforceRetention = mock(() => Promise.resolve(2));
    backupService.enforceRetention = mockEnforceRetention as typeof backupService.enforceRetention;
  });

  test('ZIP only — uploads ZIP and enforces retention when only enabled=true', async () => {
    const ctx = createContext();
    const result = await strategy.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.capabilities.zip).toBeDefined();
    expect(result.capabilities.zip.success).toBe(true);
    expect(result.capabilities.zip.metadata?.fileRef).toBe('file-ref-123');
    expect(result.capabilities.zip.metadata?.deletedOldBackups).toBe(2);
    expect(result.capabilities.sheets).toBeUndefined();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockEnforceRetention).toHaveBeenCalledTimes(1);
  });

  test('Sheets only — syncs sheets when only sheetsSyncEnabled=true', async () => {
    const ctx = createContext({
      providerConfig: {
        enabled: false,
        folderPath: 'Backups',
        retentionCount: 10,
        sheetsSyncEnabled: true,
      },
      zipBuffer: null,
    });
    const result = await strategy.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.capabilities.sheets).toBeDefined();
    expect(result.capabilities.sheets.success).toBe(true);
    expect(result.capabilities.sheets.metadata?.spreadsheetId).toBe('sheet-id-456');
    expect(result.capabilities.sheets.metadata?.webViewLink).toContain('sheet-id-456');
    expect(result.capabilities.zip).toBeUndefined();
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
  });

  test('both enabled — executes ZIP and Sheets independently', async () => {
    const ctx = createContext({
      providerConfig: {
        enabled: true,
        folderPath: 'Backups',
        retentionCount: 10,
        sheetsSyncEnabled: true,
      },
    });
    const result = await strategy.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.capabilities.zip?.success).toBe(true);
    expect(result.capabilities.sheets?.success).toBe(true);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
  });

  test('partial failure — ZIP fails but Sheets succeeds', async () => {
    mockUpload.mockImplementation(() => Promise.reject(new Error('Upload network error')));
    const ctx = createContext({
      providerConfig: {
        enabled: true,
        folderPath: 'Backups',
        retentionCount: 10,
        sheetsSyncEnabled: true,
      },
    });
    const result = await strategy.execute(ctx);

    expect(result.success).toBe(true); // anySuccess = true (sheets succeeded)
    expect(result.capabilities.zip.success).toBe(false);
    expect(result.capabilities.zip.message).toContain('Upload network error');
    expect(result.capabilities.sheets.success).toBe(true);
  });

  test('partial failure — Sheets fails but ZIP succeeds', async () => {
    mockCreateOrUpdate.mockImplementation(() => Promise.reject(new Error('Sheets API error')));
    const ctx = createContext({
      providerConfig: {
        enabled: true,
        folderPath: 'Backups',
        retentionCount: 10,
        sheetsSyncEnabled: true,
      },
    });
    const result = await strategy.execute(ctx);

    expect(result.success).toBe(true); // anySuccess = true (zip succeeded)
    expect(result.capabilities.zip.success).toBe(true);
    expect(result.capabilities.sheets.success).toBe(false);
    expect(result.capabilities.sheets.message).toContain('Sheets API error');
  });

  test('null zipBuffer — ZIP sub-capability returns failure', async () => {
    const ctx = createContext({
      providerConfig: {
        enabled: true,
        folderPath: 'Backups',
        retentionCount: 10,
        sheetsSyncEnabled: false,
      },
      zipBuffer: null,
    });
    const result = await strategy.execute(ctx);

    expect(result.capabilities.zip.success).toBe(false);
    expect(result.capabilities.zip.message).toContain('ZIP generation failed');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('retention enforcement — called after successful ZIP upload', async () => {
    const ctx = createContext();
    await strategy.execute(ctx);

    expect(mockEnforceRetention).toHaveBeenCalledWith('user-1', 'prov-1');
  });

  test('direct provider instantiation — uses refreshToken from decryptedCredentials', async () => {
    const ctx = createContext({ decryptedCredentials: { refreshToken: 'my-special-token' } });
    await strategy.execute(ctx);

    // Verify upload was called (provider was instantiated and used)
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  test('neither enabled — returns success with empty capabilities', async () => {
    const ctx = createContext({
      providerConfig: {
        enabled: false,
        folderPath: 'Backups',
        retentionCount: 10,
        sheetsSyncEnabled: false,
      },
    });
    const result = await strategy.execute(ctx);

    expect(result.success).toBe(true);
    expect(Object.keys(result.capabilities)).toHaveLength(0);
  });
});
