/**
 * Unit tests for GoogleDriveStrategy orchestration — ZIP only, Sheets only, both
 * enabled, partial failure, null zipBuffer, retention enforcement.
 *
 * Dependencies (the Drive provider + Sheets service) are injected via the
 * strategy's `deps` seam rather than `mock.module`. The old version registered
 * process-global module stubs that leaked into sibling test files (clobbering the
 * real GoogleDriveService/GoogleSheetsService that the service-level tests need).
 * Injection keeps everything file-local and leaks nothing.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { backupService } from '../../sync/backup';
import type { BackupStrategyContext } from '../../sync/backup-strategy';
import {
  GoogleDriveStrategy,
  type GoogleDriveStrategyDeps,
} from '../backup-strategies/google-drive-strategy';
import type { GoogleDriveProvider } from '../domains/storage/google-drive-provider';
import type { GoogleSheetsService } from '../services/google-sheets-service';

let mockUpload: ReturnType<typeof mock>;
let mockCreateOrUpdate: ReturnType<typeof mock>;

/** Inject minimal fakes shaped like the two collaborators the strategy calls. */
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

    // Spy on the real backupService singleton; RESTORE it afterEach so the mock
    // doesn't leak into other suites that use the real enforceRetention.
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

  test('partial failure — ZIP fails but Sheets succeeds → strategy reports FAILURE (#43)', async () => {
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

    // HONEST reporting (#43): one failed capability ⇒ the provider's backup is NOT a success, so the
    // failed ZIP is retried next run instead of being silently abandoned. (Old behavior: success=true.)
    expect(result.success).toBe(false);
    expect(result.message).toContain('Upload network error');
    expect(result.capabilities.zip?.success).toBe(false);
    expect(result.capabilities.zip?.message).toContain('Upload network error');
    expect(result.capabilities.sheets?.success).toBe(true); // the OK capability still records success
  });

  test('partial failure — Sheets fails but ZIP succeeds → strategy reports FAILURE (#43)', async () => {
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
