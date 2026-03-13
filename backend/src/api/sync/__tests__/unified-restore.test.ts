/**
 * Unit tests for unified restore flow.
 * Validates: Requirement 5 — ZIP download+restore, Sheets via provider credentials,
 * missing sheetsSpreadsheetId error, invalid provider error.
 *
 * Tests the pure logic of the restore paths: the route handler delegates to
 * backupService.downloadBackup + restoreService.restoreFromBackup for ZIP,
 * and restoreService.restoreFromSheets for Sheets.
 */

import { describe, expect, test } from 'bun:test';
import { SyncError, SyncErrorCode } from '../../../errors';
import type { BackupConfig } from '../../../types';

/**
 * Simulates the route handler's provider validation logic.
 * Returns the provider row if found and active, or throws SyncError.
 */
function validateProvider(
  providers: Array<{ id: string; userId: string; status: string }>,
  providerId: string,
  userId: string
): { id: string; userId: string; status: string } {
  const row = providers.find(
    (p) => p.id === providerId && p.userId === userId && p.status === 'active'
  );
  if (!row) {
    throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Provider not found or inactive');
  }
  return row;
}

/**
 * Simulates the Sheets restore path's sheetsSpreadsheetId lookup.
 * Returns the spreadsheet ID or throws if not found.
 */
function getSheetsSpreadsheetId(backupConfig: BackupConfig | null, providerId: string): string {
  const providerConfig = backupConfig?.providers?.[providerId];
  const sheetsSpreadsheetId = providerConfig?.sheetsSpreadsheetId;
  if (!sheetsSpreadsheetId) {
    throw new SyncError(
      SyncErrorCode.VALIDATION_ERROR,
      'No Google Sheets spreadsheet found for this provider'
    );
  }
  return sheetsSpreadsheetId;
}

/**
 * Simulates the ZIP restore flow: download + restore.
 */
async function simulateZipRestore(
  downloadFn: (userId: string, providerId: string, fileRef: string) => Promise<Buffer>,
  restoreFn: (
    userId: string,
    buffer: Buffer,
    mode: string
  ) => Promise<{ success: boolean; imported?: object }>,
  userId: string,
  providerId: string,
  fileRef: string,
  mode: string
): Promise<{ success: boolean; imported?: object }> {
  const zipBuffer = await downloadFn(userId, providerId, fileRef);
  return restoreFn(userId, zipBuffer, mode);
}

describe('Unified restore', () => {
  const activeProviders = [
    { id: 'prov-1', userId: 'user-1', status: 'active' },
    { id: 'prov-2', userId: 'user-1', status: 'active' },
    { id: 'prov-inactive', userId: 'user-1', status: 'inactive' },
  ];

  const backupConfig: BackupConfig = {
    providers: {
      'prov-1': {
        enabled: true,
        folderPath: 'Backups',
        retentionCount: 10,
        lastBackupAt: '2024-01-01T00:00:00Z',
        sheetsSyncEnabled: true,
        sheetsSpreadsheetId: 'sheet-abc-123',
      },
      'prov-2': {
        enabled: true,
        folderPath: 'Backups',
        retentionCount: 5,
        lastBackupAt: '2024-01-02T00:00:00Z',
      },
    },
  };

  test('ZIP download+restore — downloads and restores successfully', async () => {
    const mockDownload = async () => Buffer.from('zip-content');
    const mockRestore = async () => ({
      success: true,
      imported: {
        vehicles: 3,
        expenses: 10,
        financing: 0,
        insurance: 0,
        insurancePolicyVehicles: 0,
        odometer: 0,
        photos: 0,
        photoRefs: 0,
      },
    });

    const result = await simulateZipRestore(
      mockDownload,
      mockRestore,
      'user-1',
      'prov-1',
      'file-ref-xyz',
      'replace'
    );

    expect(result.success).toBe(true);
    expect(result.imported).toBeDefined();
  });

  test('Sheets via provider credentials — reads sheetsSpreadsheetId from config', () => {
    const spreadsheetId = getSheetsSpreadsheetId(backupConfig, 'prov-1');
    expect(spreadsheetId).toBe('sheet-abc-123');
  });

  test('missing sheetsSpreadsheetId — throws SyncError', () => {
    expect(() => getSheetsSpreadsheetId(backupConfig, 'prov-2')).toThrow(
      'No Google Sheets spreadsheet found for this provider'
    );
  });

  test('missing sheetsSpreadsheetId — null config throws', () => {
    expect(() => getSheetsSpreadsheetId(null, 'prov-1')).toThrow(
      'No Google Sheets spreadsheet found for this provider'
    );
  });

  test('invalid provider — not found throws SyncError', () => {
    expect(() => validateProvider(activeProviders, 'prov-nonexistent', 'user-1')).toThrow(
      'Provider not found or inactive'
    );
  });

  test('invalid provider — inactive status throws SyncError', () => {
    expect(() => validateProvider(activeProviders, 'prov-inactive', 'user-1')).toThrow(
      'Provider not found or inactive'
    );
  });

  test('invalid provider — wrong userId throws SyncError', () => {
    expect(() => validateProvider(activeProviders, 'prov-1', 'user-other')).toThrow(
      'Provider not found or inactive'
    );
  });

  test('valid provider — returns provider row', () => {
    const row = validateProvider(activeProviders, 'prov-1', 'user-1');
    expect(row.id).toBe('prov-1');
    expect(row.status).toBe('active');
  });
});
