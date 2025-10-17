import { Hono } from 'hono';
import type { ParsedBackupData } from '../lib/backup-service';
import { backupService } from '../lib/backup-service';
import { requireAuth } from '../lib/middleware/auth';

const sync = new Hono();

// All sync routes require authentication
sync.use('*', requireAuth);

/**
 * Validate CSV data structure
 */
function validateBackupData(parsedBackup: ParsedBackupData): string[] {
  const requiredFields = {
    vehicles: ['id', 'make', 'model', 'year'],
    expenses: ['id', 'vehicleId', 'category', 'amount', 'date'],
    financing: ['id', 'vehicleId', 'financingType'],
    financingPayments: ['id', 'financingId', 'paymentDate', 'paymentAmount'],
    insurance: ['id', 'vehicleId', 'company'],
  };

  const validationErrors: string[] = [];

  // Validate vehicles
  if (parsedBackup.vehicles.length > 0) {
    const vehicleFields = Object.keys(parsedBackup.vehicles[0]);
    const missingFields = requiredFields.vehicles.filter((field) => !vehicleFields.includes(field));
    if (missingFields.length > 0) {
      validationErrors.push(`Vehicles CSV missing required fields: ${missingFields.join(', ')}`);
    }
  }

  // Validate expenses
  if (parsedBackup.expenses.length > 0) {
    const expenseFields = Object.keys(parsedBackup.expenses[0]);
    const missingFields = requiredFields.expenses.filter((field) => !expenseFields.includes(field));
    if (missingFields.length > 0) {
      validationErrors.push(`Expenses CSV missing required fields: ${missingFields.join(', ')}`);
    }
  }

  // Validate financing
  if (parsedBackup.financing.length > 0) {
    const financingFields = Object.keys(parsedBackup.financing[0]);
    const missingFields = requiredFields.financing.filter(
      (field) => !financingFields.includes(field)
    );
    if (missingFields.length > 0) {
      validationErrors.push(`Financing CSV missing required fields: ${missingFields.join(', ')}`);
    }
  }

  // Validate financing payments
  if (parsedBackup.financingPayments.length > 0) {
    const paymentFields = Object.keys(parsedBackup.financingPayments[0]);
    const missingFields = requiredFields.financingPayments.filter(
      (field) => !paymentFields.includes(field)
    );
    if (missingFields.length > 0) {
      validationErrors.push(
        `Financing payments CSV missing required fields: ${missingFields.join(', ')}`
      );
    }
  }

  // Validate insurance
  if (parsedBackup.insurance.length > 0) {
    const insuranceFields = Object.keys(parsedBackup.insurance[0]);
    const missingFields = requiredFields.insurance.filter(
      (field) => !insuranceFields.includes(field)
    );
    if (missingFields.length > 0) {
      validationErrors.push(`Insurance CSV missing required fields: ${missingFields.join(', ')}`);
    }
  }

  return validationErrors;
}

/**
 * GET /api/sync/download
 * Download a backup ZIP file of all user data
 */
sync.get('/download', async (c) => {
  try {
    const user = c.get('user');
    const userId = user.id;

    // Generate backup ZIP
    const zipBuffer = await backupService.exportAsZip(userId);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `vroom-backup-${timestamp}.zip`;

    // Return buffer as response
    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error generating backup:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'BACKUP_GENERATION_FAILED',
          message: 'Failed to generate backup file',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      500
    );
  }
});

/**
 * POST /api/sync/restore
 * Restore data from an uploaded backup file
 */
sync.post('/restore', async (c) => {
  try {
    const user = c.get('user');
    const userId = user.id;

    // Parse multipart form data
    const body = await c.req.parseBody();
    const file = body.file;
    const mode = (body.mode as string) || 'preview';

    // Validate file exists
    if (!file || !(file instanceof File)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No file uploaded or invalid file format',
          },
        },
        400
      );
    }

    // Validate mode
    if (!['preview', 'replace', 'merge'].includes(mode)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid restore mode. Must be one of: preview, replace, merge',
          },
        },
        400
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Import sync service
    const { syncService } = await import('../lib/sync-service');

    // Restore from backup
    const result = await syncService.restoreFromBackup(
      userId,
      fileBuffer,
      mode as 'preview' | 'replace' | 'merge'
    );

    return c.json(result);
  } catch (error) {
    console.error('Error restoring backup:', error);

    // Handle SyncError
    if (error && typeof error === 'object' && 'code' in error) {
      const syncError = error as { code: string; message: string; details?: unknown };
      return c.json(
        {
          success: false,
          error: {
            code: syncError.code,
            message: syncError.message,
            details: syncError.details,
          },
        },
        400
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'RESTORE_FAILED',
          message: 'Failed to restore backup',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      500
    );
  }
});

/**
 * POST /api/sync/upload
 * Upload and validate a backup ZIP file
 */
sync.post('/upload', async (c) => {
  try {
    const user = c.get('user');
    const userId = user.id;

    // Parse multipart form data
    const body = await c.req.parseBody();
    const file = body.file;

    // Validate file exists
    if (!file || !(file instanceof File)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No file uploaded or invalid file format',
          },
        },
        400
      );
    }

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB in bytes
    if (file.size > maxSize) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `File size exceeds maximum allowed size of 50MB (uploaded: ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
          },
        },
        400
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Parse and validate ZIP structure
    let parsedBackup: ParsedBackupData;
    try {
      parsedBackup = await backupService.parseZipBackup(fileBuffer);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_FILE_FORMAT',
            message: 'Invalid backup file format',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
        },
        400
      );
    }

    // Validate metadata version
    const currentVersion = '1.0.0';
    if (parsedBackup.metadata.version !== currentVersion) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VERSION_MISMATCH',
            message: `Backup version ${parsedBackup.metadata.version} is not compatible with current version ${currentVersion}`,
          },
        },
        400
      );
    }

    // Validate userId matches
    if (parsedBackup.metadata.userId !== userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Backup file belongs to a different user',
          },
        },
        400
      );
    }

    // Validate CSV data structure
    const validationErrors = validateBackupData(parsedBackup);
    if (validationErrors.length > 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Backup file validation failed',
            details: validationErrors,
          },
        },
        400
      );
    }

    // Get restore mode from query params or body
    const mode = (body.mode as string) || 'preview';
    if (!['preview', 'replace', 'merge'].includes(mode)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid restore mode. Must be one of: preview, replace, merge',
          },
        },
        400
      );
    }

    // Return validation success with preview data
    return c.json({
      success: true,
      message: 'Backup file validated successfully',
      metadata: parsedBackup.metadata,
      summary: {
        vehicles: parsedBackup.vehicles.length,
        expenses: parsedBackup.expenses.length,
        financing: parsedBackup.financing.length,
        financingPayments: parsedBackup.financingPayments.length,
        insurance: parsedBackup.insurance.length,
      },
    });
  } catch (error) {
    console.error('Error uploading backup:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: 'Failed to upload and validate backup file',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      500
    );
  }
});

/**
 * POST /api/sync/restore-from-sheets
 * Restore data from Google Sheets
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Error handling requires checking multiple error types
sync.post('/restore-from-sheets', async (c) => {
  try {
    const user = c.get('user');
    const userId = user.id;

    // Parse request body
    const body = await c.req.json();
    const mode = body.mode || 'preview';

    // Validate mode
    if (!['preview', 'replace', 'merge'].includes(mode)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid restore mode. Must be one of: preview, replace, merge',
          },
        },
        400
      );
    }

    // Import sync service
    const { syncService } = await import('../lib/sync-service');

    // Restore from sheets
    const result = await syncService.restoreFromSheets(
      userId,
      mode as 'preview' | 'replace' | 'merge'
    );

    return c.json(result);
  } catch (error) {
    console.error('Error restoring from sheets:', error);

    // Handle SyncError
    if (error && typeof error === 'object' && 'code' in error) {
      const syncError = error as { code: string; message: string; details?: unknown };

      // Map error codes to HTTP status codes
      if (syncError.code === 'AUTH_INVALID') {
        return c.json(
          {
            success: false,
            error: {
              code: syncError.code,
              message: syncError.message,
              details: syncError.details,
            },
          },
          401
        );
      }

      if (syncError.code === 'VALIDATION_ERROR') {
        return c.json(
          {
            success: false,
            error: {
              code: syncError.code,
              message: syncError.message,
              details: syncError.details,
            },
          },
          400
        );
      }

      if (syncError.code === 'CONFLICT_DETECTED') {
        return c.json(
          {
            success: false,
            error: {
              code: syncError.code,
              message: syncError.message,
              details: syncError.details,
            },
          },
          409
        );
      }

      return c.json(
        {
          success: false,
          error: {
            code: syncError.code,
            message: syncError.message,
            details: syncError.details,
          },
        },
        500
      );
    }

    return c.json(
      {
        success: false,
        error: {
          code: 'RESTORE_FAILED',
          message: 'Failed to restore from Google Sheets',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      500
    );
  }
});

export { sync };
