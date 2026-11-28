import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { backupService, RetentionIncompleteError } from '../../sync/backup';
import type { BackupStrategyContext } from '../../sync/backup-strategy';
import {
  GoogleDriveStrategy,
  type GoogleDriveStrategyDeps,
} from '../backup-strategies/google-drive-strategy';
import { RETENTION_WARNING } from '../backup-strategies/zip-strategy';
import type { GoogleDriveProvider } from '../domains/storage/google-drive-provider';
import { healthFailure } from '../provider-status';
import type { GoogleSheetsService } from '../services/google-sheets-service';

let mockUpload: ReturnType<typeof mock>;
let mockCreateOrUpdate: ReturnType<typeof mock>;

function makeDeps(): GoogleDriveStrategyDeps {
  return {
    createDriveProvider: (_token: string) =>
      ({ upload: mockUpload }) as unknown as GoogleDriveProvider,
    createSheetsService: (_token: string) =>
      ({ createOrUpdateVroomSpreadsheet: mockCreateOrUpdate }) as unknown as GoogleSheetsService,
  };
}

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
  let strategy: GoogleDriveStrategy;
  let mockEnforceRetention: ReturnType<typeof mock>;
  let originalEnforceRetention: typeof backupService.enforceRetention;

  beforeEach(() => {
    mockUpload = mock(() => Promise.resolve({ externalId: 'file-ref-123' }));
    mockCreateOrUpdate = mock(() =>
      Promise.resolve({
        id: 'sheet-id-456',
        webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-id-456',
      })
    );
    strategy = new GoogleDriveStrategy(makeDeps());

    originalEnforceRetention = backupService.enforceRetention;
    mockEnforceRetention = mock(() => Promise.resolve(2));
    backupService.enforceRetention = mockEnforceRetention as typeof backupService.enforceRetention;
  });

  afterEach(() => {
    backupService.enforceRetention = originalEnforceRetention;
  });

  test('ZIP only — uploads ZIP and enforces retention when only enabled=true', async () => {
    const result = await strategy.execute(createContext());

    expect(result.success).toBe(true);
    expect(result.capabilities.zip?.success).toBe(true);
    expect(result.capabilities.zip?.metadata?.fileRef).toBe('file-ref-123');
    expect(result.capabilities.zip?.metadata?.deletedOldBackups).toBe(2);
    expect(result.capabilities.sheets).toBeUndefined();
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockEnforceRetention).toHaveBeenCalledTimes(1);
  });

  test('a failed cleanup of old backups keeps the upload a success, with a warning', async () => {
    backupService.enforceRetention = mock(() =>
      Promise.reject(new Error('AccessDenied: list not allowed'))
    ) as typeof backupService.enforceRetention;

    const result = await strategy.execute(createContext());

    expect(result.success).toBe(true);
    expect(result.capabilities.zip?.success).toBe(true);
    expect(result.capabilities.zip?.warning).toBe(RETENTION_WARNING);
    expect(result.capabilities.zip?.metadata?.fileRef).toBe('file-ref-123');
    expect(result.capabilities.zip?.metadata?.deletedOldBackups).toBe(0);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  test('a successful cleanup carries no warning', async () => {
    const result = await strategy.execute(createContext());
    expect(result.capabilities.zip?.warning).toBeUndefined();
  });

  test('a cleanup that could not delete every old backup warns and reports what it did delete', async () => {
    backupService.enforceRetention = mock(() =>
      Promise.reject(new RetentionIncompleteError(1))
    ) as typeof backupService.enforceRetention;

    const result = await strategy.execute(createContext());

    expect(result.capabilities.zip?.success).toBe(true);
    expect(result.capabilities.zip?.warning).toBe(RETENTION_WARNING);
    expect(result.capabilities.zip?.metadata?.deletedOldBackups).toBe(1);
  });

  test('a failed upload never triggers the cleanup of old backups', async () => {
    mockUpload = mock(() => Promise.reject(new Error('Upload network error')));
    strategy = new GoogleDriveStrategy(makeDeps());

    const result = await strategy.execute(createContext());

    expect(result.capabilities.zip?.success).toBe(false);
    expect(mockEnforceRetention).not.toHaveBeenCalled();
  });

  test('a revoked sign-in fails the ZIP upload as an auth failure with the reconnect message', async () => {
    mockUpload = mock(() => Promise.reject(new Error('invalid_grant: Token has been revoked')));
    strategy = new GoogleDriveStrategy(makeDeps());

    const result = await strategy.execute(createContext());

    expect(result.success).toBe(false);
    expect(result.capabilities.zip?.failure).toBe('auth');
    expect(result.capabilities.zip?.message).toBe(healthFailure('auth').message);
    expect(result.capabilities.zip?.message).not.toContain('invalid_grant');
  });

  test('refused access fails Sheets sync as a permission failure', async () => {
    mockCreateOrUpdate = mock(() =>
      Promise.reject(Object.assign(new Error('Forbidden'), { response: { status: 403 } }))
    );
    strategy = new GoogleDriveStrategy(makeDeps());

    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: false,
          folderPath: 'B',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
        zipBuffer: null,
      })
    );

    expect(result.capabilities.sheets?.failure).toBe('permission');
    expect(result.capabilities.sheets?.message).toBe(healthFailure('permission').message);
  });

  test('an ordinary upload error keeps its message and has no failure class', async () => {
    mockUpload = mock(() => Promise.reject(new Error('Upload network error')));
    strategy = new GoogleDriveStrategy(makeDeps());

    const result = await strategy.execute(createContext());

    expect(result.capabilities.zip?.failure).toBeUndefined();
    expect(result.capabilities.zip?.message).toBe('Upload network error');
  });

  test('Sheets only — syncs sheets when only sheetsSyncEnabled=true', async () => {
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
        zipBuffer: null,
      })
    );

    expect(result.success).toBe(true);
    expect(result.capabilities.sheets?.success).toBe(true);
    expect(result.capabilities.sheets?.metadata?.spreadsheetId).toBe('sheet-id-456');
    expect(result.capabilities.sheets?.metadata?.webViewLink).toContain('sheet-id-456');
    expect(result.capabilities.zip).toBeUndefined();
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
  });

  test('both enabled — executes ZIP and Sheets independently', async () => {
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.capabilities.zip?.success).toBe(true);
    expect(result.capabilities.sheets?.success).toBe(true);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
  });

  test('partial failure — ZIP fails but Sheets succeeds → strategy reports FAILURE', async () => {
    mockUpload.mockImplementation(() => Promise.reject(new Error('Upload network error')));
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Upload network error');
    expect(result.capabilities.zip?.success).toBe(false);
    expect(result.capabilities.zip?.message).toContain('Upload network error');
    expect(result.capabilities.sheets?.success).toBe(true);
  });

  test('partial failure — Sheets fails but ZIP succeeds → strategy reports FAILURE', async () => {
    mockCreateOrUpdate.mockImplementation(() => Promise.reject(new Error('Sheets API error')));
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Sheets API error');
    expect(result.capabilities.zip?.success).toBe(true);
    expect(result.capabilities.sheets?.success).toBe(false);
    expect(result.capabilities.sheets?.message).toContain('Sheets API error');
  });

  test('both capabilities fail → strategy reports failure with both messages joined', async () => {
    mockUpload.mockImplementation(() => Promise.reject(new Error('Upload network error')));
    mockCreateOrUpdate.mockImplementation(() => Promise.reject(new Error('Sheets API error')));
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: true,
        },
      })
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('Upload network error');
    expect(result.message).toContain('Sheets API error');
  });

  test('null zipBuffer — ZIP sub-capability returns failure', async () => {
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: true,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: false,
        },
        zipBuffer: null,
      })
    );

    expect(result.capabilities.zip?.success).toBe(false);
    expect(result.capabilities.zip?.message).toContain('ZIP generation failed');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('retention enforcement — called after successful ZIP upload', async () => {
    await strategy.execute(createContext());
    expect(mockEnforceRetention).toHaveBeenCalledWith('user-1', 'prov-1');
  });

  test('direct provider instantiation — uses refreshToken from decryptedCredentials', async () => {
    await strategy.execute(createContext({ decryptedCredentials: { refreshToken: 'my-token' } }));
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  test('neither enabled — returns success with empty capabilities', async () => {
    const result = await strategy.execute(
      createContext({
        providerConfig: {
          enabled: false,
          folderPath: 'Backups',
          retentionCount: 10,
          sheetsSyncEnabled: false,
        },
      })
    );

    expect(result.success).toBe(true);
    expect(Object.keys(result.capabilities)).toHaveLength(0);
  });
});
