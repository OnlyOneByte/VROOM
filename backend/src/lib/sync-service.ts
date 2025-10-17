/**
 * Error codes for sync operations
 */
export enum SyncErrorCode {
  AUTH_INVALID = 'AUTH_INVALID',
  NETWORK_ERROR = 'NETWORK_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CONFLICT_DETECTED = 'CONFLICT_DETECTED',
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  VERSION_MISMATCH = 'VERSION_MISMATCH',
}

/**
 * Custom error class for sync operations
 */
export class SyncError extends Error {
  constructor(
    public code: SyncErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/**
 * Metadata for backup files
 */
export interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
}

/**
 * Complete backup data structure
 */
export interface BackupData {
  metadata: BackupMetadata;
  vehicles: unknown[];
  expenses: unknown[];
  financing: unknown[];
  financingPayments: unknown[];
  insurance: unknown[];
}

/**
 * Conflict information for merge operations
 */
export interface Conflict {
  table: string;
  id: string;
  localData: unknown;
  remoteData: unknown;
}

/**
 * Request to trigger sync operations
 */
export interface SyncRequest {
  syncTypes: ('sheets' | 'backup')[];
}

/**
 * Result of sheets sync operation
 */
export interface SheetsSyncResult {
  spreadsheetId: string;
  webViewLink: string;
  lastSyncDate: string;
}

/**
 * Result of backup sync operation
 */
export interface BackupSyncResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  lastBackupDate: string;
}

/**
 * Response from sync operations
 */
export interface SyncResponse {
  success: boolean;
  results: {
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
  };
  errors?: {
    sheets?: string;
    backup?: string;
  };
}

/**
 * Request to restore data
 */
export interface RestoreRequest {
  mode: 'replace' | 'merge' | 'preview';
}

/**
 * Summary of data to be imported
 */
export interface ImportSummary {
  vehicles: number;
  expenses: number;
  financing: number;
  financingPayments: number;
  insurance: number;
}

/**
 * Response from restore operations
 */
export interface RestoreResponse {
  success: boolean;
  preview?: ImportSummary;
  imported?: ImportSummary;
  conflicts?: Conflict[];
}

/**
 * Helper function to convert CSV string values to proper types
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Type conversion requires checking multiple field patterns
function convertCSVValue(value: string, fieldName: string): unknown {
  // Empty string means null
  if (value === '' || value === 'null' || value === 'undefined' || value === 'NULL') {
    return null;
  }

  // Date/timestamp fields (ending with 'At' or 'Date', or is 'date')
  if (fieldName.endsWith('At') || fieldName.endsWith('Date') || fieldName === 'date') {
    // Try to parse as date
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }

  // Boolean fields
  if (fieldName.startsWith('is') || fieldName === 'isActive' || fieldName === 'isScheduled') {
    return value === 'true' || value === '1' || value === 'TRUE';
  }

  // Numeric fields - check common patterns
  if (
    fieldName.includes('amount') ||
    fieldName.includes('Amount') ||
    fieldName.includes('price') ||
    fieldName.includes('Price') ||
    fieldName.includes('cost') ||
    fieldName.includes('Cost') ||
    fieldName.includes('balance') ||
    fieldName.includes('Balance') ||
    fieldName === 'apr' ||
    fieldName === 'gallons' ||
    fieldName === 'mileage' ||
    fieldName === 'initialMileage' ||
    fieldName === 'mileageLimit' ||
    fieldName === 'excessMileageFee' ||
    fieldName === 'residualValue'
  ) {
    const num = Number.parseFloat(value);
    return Number.isNaN(num) ? null : num;
  }

  // Integer fields
  if (
    fieldName === 'year' ||
    fieldName === 'termMonths' ||
    fieldName === 'termLengthMonths' ||
    fieldName === 'paymentNumber' ||
    fieldName === 'paymentDayOfMonth' ||
    fieldName === 'paymentDayOfWeek'
  ) {
    const num = Number.parseInt(value, 10);
    return Number.isNaN(num) ? null : num;
  }

  // Default: return as string
  return value;
}

/**
 * Convert CSV row data to properly typed object
 */
function convertCSVRow(row: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    converted[key] = convertCSVValue(String(value), key);
  }
  return converted;
}

/**
 * Service for managing unified sync operations
 */
export class SyncService {
  /**
   * Execute sync operations for specified types
   */
  async executeSync(
    userId: string,
    syncTypes: string[]
  ): Promise<{
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
    errors?: Record<string, string>;
  }> {
    // Validate syncTypes array
    this.validateSyncTypes(syncTypes);

    // Execute sync operations in parallel using Promise.allSettled
    const syncPromises = this.createSyncPromises(userId, syncTypes);
    const results = await Promise.allSettled(syncPromises);

    // Collect results and errors
    return this.collectSyncResults(results, syncTypes);
  }

  /**
   * Validate sync types array
   */
  private validateSyncTypes(syncTypes: string[]): void {
    if (!syncTypes || syncTypes.length === 0) {
      throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'syncTypes array cannot be empty');
    }

    const validSyncTypes = ['sheets', 'backup'];
    const invalidTypes = syncTypes.filter((type) => !validSyncTypes.includes(type));
    if (invalidTypes.length > 0) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        `Invalid sync types: ${invalidTypes.join(', ')}. Valid types are: ${validSyncTypes.join(', ')}`
      );
    }
  }

  /**
   * Create sync promises for each sync type
   */
  private createSyncPromises(
    userId: string,
    syncTypes: string[]
  ): Promise<{ type: string; result: SheetsSyncResult | BackupSyncResult }>[] {
    return syncTypes.map(async (type) => {
      if (type === 'sheets') {
        return { type: 'sheets', result: await this.syncToSheets(userId) };
      }
      if (type === 'backup') {
        return { type: 'backup', result: await this.uploadToGoogleDrive(userId) };
      }
      throw new Error(`Unknown sync type: ${type}`);
    });
  }

  /**
   * Collect results from Promise.allSettled
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Result collection requires checking multiple result types
  private collectSyncResults(
    results: PromiseSettledResult<{ type: string; result: SheetsSyncResult | BackupSyncResult }>[],
    syncTypes: string[]
  ): {
    sheets?: SheetsSyncResult;
    backup?: BackupSyncResult;
    errors?: Record<string, string>;
  } {
    const response: {
      sheets?: SheetsSyncResult;
      backup?: BackupSyncResult;
      errors?: Record<string, string>;
    } = {};

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { type, result: syncResult } = result.value;
        if (type === 'sheets') {
          response.sheets = syncResult as SheetsSyncResult;
        } else if (type === 'backup') {
          response.backup = syncResult as BackupSyncResult;
        }
      } else {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        const failedIndex = results.indexOf(result);
        const failedType = syncTypes[failedIndex];

        if (!response.errors) {
          response.errors = {};
        }
        response.errors[failedType] = errorMessage;
      }
    }

    return response;
  }

  /**
   * Generate backup ZIP file
   */
  async generateBackup(_userId: string): Promise<Buffer> {
    // TODO: Implement in task 2.1
    throw new Error('Not implemented');
  }

  /**
   * Restore from backup file
   */
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    const { backupService } = await import('./backup-service');
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { vehicles, expenses, vehicleFinancing, vehicleFinancingPayments, insurancePolicies } =
      await import('../db/schema');

    // Parse backup file
    const parsedBackup = await backupService.parseZipBackup(file);

    // Validate userId matches
    if (parsedBackup.metadata.userId !== userId) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Backup file belongs to a different user'
      );
    }

    const summary: ImportSummary = {
      vehicles: parsedBackup.vehicles.length,
      expenses: parsedBackup.expenses.length,
      financing: parsedBackup.financing.length,
      financingPayments: parsedBackup.financingPayments.length,
      insurance: parsedBackup.insurance.length,
    };

    // Preview mode: just return summary
    if (mode === 'preview') {
      return {
        success: true,
        preview: summary,
      };
    }

    const db = databaseService.getDatabase();

    // Merge mode: detect conflicts
    if (mode === 'merge') {
      const conflicts = await this.detectConflicts(userId, parsedBackup);
      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
        };
      }
    }

    // Replace or merge mode: perform restore in transaction
    try {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Transaction logic requires multiple conditional steps
      await db.transaction(async (tx) => {
        // Replace mode: delete all existing user data
        if (mode === 'replace') {
          // Get all vehicle IDs for this user
          const userVehicles = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(eq(vehicles.userId, userId));

          const vehicleIds = userVehicles.map((v) => v.id);

          if (vehicleIds.length > 0) {
            const { inArray } = await import('drizzle-orm');

            // Get all financing IDs for these vehicles
            const userFinancing = await tx
              .select({ id: vehicleFinancing.id })
              .from(vehicleFinancing)
              .where(inArray(vehicleFinancing.vehicleId, vehicleIds));

            const financingIds = userFinancing.map((f) => f.id);

            // Delete in correct order (child tables first)
            if (financingIds.length > 0) {
              await tx
                .delete(vehicleFinancingPayments)
                .where(inArray(vehicleFinancingPayments.financingId, financingIds));
            }

            await tx
              .delete(vehicleFinancing)
              .where(inArray(vehicleFinancing.vehicleId, vehicleIds));

            await tx
              .delete(insurancePolicies)
              .where(inArray(insurancePolicies.vehicleId, vehicleIds));

            await tx.delete(expenses).where(inArray(expenses.vehicleId, vehicleIds));
          }

          await tx.delete(vehicles).where(eq(vehicles.userId, userId));
        }

        // Insert backup data with proper type conversion
        if (parsedBackup.vehicles.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: CSV data is dynamic
          await tx
            .insert(vehicles)
            .values(parsedBackup.vehicles.map((v: any) => convertCSVRow(v)) as any);
        }

        if (parsedBackup.expenses.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: CSV data is dynamic
          await tx
            .insert(expenses)
            .values(parsedBackup.expenses.map((e: any) => convertCSVRow(e)) as any);
        }

        if (parsedBackup.financing.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: CSV data is dynamic
          await tx
            .insert(vehicleFinancing)
            .values(parsedBackup.financing.map((f: any) => convertCSVRow(f)) as any);
        }

        if (parsedBackup.financingPayments.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: CSV data is dynamic
          await tx
            .insert(vehicleFinancingPayments)
            .values(parsedBackup.financingPayments.map((p: any) => convertCSVRow(p)) as any);
        }

        if (parsedBackup.insurance.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: CSV data is dynamic
          await tx
            .insert(insurancePolicies)
            .values(parsedBackup.insurance.map((i: any) => convertCSVRow(i)) as any);
        }
      });

      return {
        success: true,
        imported: summary,
      };
    } catch (error) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Failed to restore backup',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Detect conflicts between local and remote data
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Conflict detection requires checking multiple tables
  private async detectConflicts(
    userId: string,
    remoteData: {
      vehicles: Record<string, unknown>[];
      expenses: Record<string, unknown>[];
      financing: Record<string, unknown>[];
      financingPayments: Record<string, unknown>[];
      insurance: Record<string, unknown>[];
    }
  ): Promise<Conflict[]> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { vehicles, expenses, vehicleFinancing, vehicleFinancingPayments, insurancePolicies } =
      await import('../db/schema');

    const db = databaseService.getDatabase();
    const conflicts: Conflict[] = [];

    // Get all local data
    const [localVehicles, localExpenses, localFinancing, localFinancingPayments, localInsurance] =
      await Promise.all([
        db.select().from(vehicles).where(eq(vehicles.userId, userId)),
        db
          .select()
          .from(expenses)
          .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.expenses)),
        db
          .select()
          .from(vehicleFinancing)
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.vehicle_financing)),
        db
          .select()
          .from(vehicleFinancingPayments)
          .innerJoin(
            vehicleFinancing,
            eq(vehicleFinancingPayments.financingId, vehicleFinancing.id)
          )
          .innerJoin(vehicles, eq(vehicleFinancing.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.vehicle_financing_payments)),
        db
          .select()
          .from(insurancePolicies)
          .innerJoin(vehicles, eq(insurancePolicies.vehicleId, vehicles.id))
          .where(eq(vehicles.userId, userId))
          .then((results) => results.map((r) => r.insurance_policies)),
      ]);

    // Check for conflicts in vehicles
    for (const remoteVehicle of remoteData.vehicles) {
      const localVehicle = localVehicles.find((v) => v.id === remoteVehicle.id);
      if (localVehicle && JSON.stringify(localVehicle) !== JSON.stringify(remoteVehicle)) {
        conflicts.push({
          table: 'vehicles',
          id: remoteVehicle.id as string,
          localData: localVehicle,
          remoteData: remoteVehicle,
        });
      }
    }

    // Check for conflicts in expenses
    for (const remoteExpense of remoteData.expenses) {
      const localExpense = localExpenses.find((e) => e.id === remoteExpense.id);
      if (localExpense && JSON.stringify(localExpense) !== JSON.stringify(remoteExpense)) {
        conflicts.push({
          table: 'expenses',
          id: remoteExpense.id as string,
          localData: localExpense,
          remoteData: remoteExpense,
        });
      }
    }

    // Check for conflicts in financing
    for (const remoteFinancing of remoteData.financing) {
      const localFinancingItem = localFinancing.find((f) => f.id === remoteFinancing.id);
      if (
        localFinancingItem &&
        JSON.stringify(localFinancingItem) !== JSON.stringify(remoteFinancing)
      ) {
        conflicts.push({
          table: 'vehicle_financing',
          id: remoteFinancing.id as string,
          localData: localFinancingItem,
          remoteData: remoteFinancing,
        });
      }
    }

    // Check for conflicts in financing payments
    for (const remotePayment of remoteData.financingPayments) {
      const localPayment = localFinancingPayments.find((p) => p.id === remotePayment.id);
      if (localPayment && JSON.stringify(localPayment) !== JSON.stringify(remotePayment)) {
        conflicts.push({
          table: 'vehicle_financing_payments',
          id: remotePayment.id as string,
          localData: localPayment,
          remoteData: remotePayment,
        });
      }
    }

    // Check for conflicts in insurance
    for (const remoteInsurance of remoteData.insurance) {
      const localInsuranceItem = localInsurance.find((i) => i.id === remoteInsurance.id);
      if (
        localInsuranceItem &&
        JSON.stringify(localInsuranceItem) !== JSON.stringify(remoteInsurance)
      ) {
        conflicts.push({
          table: 'insurance_policies',
          id: remoteInsurance.id as string,
          localData: localInsuranceItem,
          remoteData: remoteInsurance,
        });
      }
    }

    return conflicts;
  }

  /**
   * Sync data to Google Sheets
   */
  async syncToSheets(userId: string): Promise<SheetsSyncResult> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { users, userSettings } = await import('../db/schema');
    const { GoogleSheetsService } = await import('./google-sheets');

    const db = databaseService.getDatabase();

    // Get user settings to verify googleSheetsSyncEnabled
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    if (!settings.length || !settings[0].googleSheetsSyncEnabled) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Google Sheets sync is not enabled for this user'
      );
    }

    // Get user info for tokens and name
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user.length || !user[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    try {
      // Create GoogleSheetsService instance with user tokens
      const sheetsService = new GoogleSheetsService(
        user[0].googleRefreshToken,
        user[0].googleRefreshToken
      );

      // Call createOrUpdateVroomSpreadsheet
      const spreadsheetInfo = await sheetsService.createOrUpdateVroomSpreadsheet(
        userId,
        user[0].displayName
      );

      // Update lastSyncDate and spreadsheetId in user settings
      await db
        .update(userSettings)
        .set({
          lastSyncDate: new Date(),
          googleSheetsSpreadsheetId: spreadsheetInfo.id,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));

      // Return spreadsheet info
      return {
        spreadsheetId: spreadsheetInfo.id,
        webViewLink: spreadsheetInfo.webViewLink,
        lastSyncDate: new Date().toISOString(),
      };
    } catch (error) {
      // Handle authentication errors
      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      // Re-throw SyncErrors as-is
      if (error instanceof SyncError) {
        throw error;
      }

      // Wrap other errors
      throw new SyncError(
        SyncErrorCode.NETWORK_ERROR,
        'Failed to sync to Google Sheets',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Restore data from Google Sheets
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Restore logic requires multiple validation and transaction steps
  async restoreFromSheets(
    userId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResponse> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const {
      users,
      userSettings,
      vehicles,
      expenses,
      vehicleFinancing,
      vehicleFinancingPayments,
      insurancePolicies,
    } = await import('../db/schema');
    const { GoogleSheetsService } = await import('./google-sheets');

    const db = databaseService.getDatabase();

    // Get user settings to get spreadsheet ID
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    if (!settings.length || !settings[0].googleSheetsSpreadsheetId) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'No Google Sheets spreadsheet found for this user'
      );
    }

    // Get user info for tokens
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user.length || !user[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    try {
      // Create GoogleSheetsService instance
      const sheetsService = new GoogleSheetsService(
        user[0].googleRefreshToken,
        user[0].googleRefreshToken
      );

      // Read data from spreadsheet
      const sheetData = await sheetsService.readSpreadsheetData(
        settings[0].googleSheetsSpreadsheetId
      );

      // Validate userId matches
      if (sheetData.metadata.userId !== userId) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Spreadsheet data belongs to a different user'
        );
      }

      // Validate data types and formats
      this.validateSheetData(sheetData);

      const summary: ImportSummary = {
        vehicles: sheetData.vehicles.length,
        expenses: sheetData.expenses.length,
        financing: sheetData.financing.length,
        financingPayments: sheetData.financingPayments.length,
        insurance: sheetData.insurance.length,
      };

      // Preview mode: just return summary
      if (mode === 'preview') {
        return {
          success: true,
          preview: summary,
        };
      }

      // Merge mode: detect conflicts
      if (mode === 'merge') {
        const conflicts = await this.detectConflicts(userId, sheetData);
        if (conflicts.length > 0) {
          return {
            success: false,
            conflicts,
          };
        }
      }

      // Replace or merge mode: perform restore in transaction
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Transaction logic requires multiple conditional steps
      await db.transaction(async (tx) => {
        // Replace mode: delete all existing user data
        if (mode === 'replace') {
          // Get all vehicle IDs for this user
          const userVehicles = await tx
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(eq(vehicles.userId, userId));

          const vehicleIds = userVehicles.map((v) => v.id);

          if (vehicleIds.length > 0) {
            const { inArray } = await import('drizzle-orm');

            // Get all financing IDs for these vehicles
            const userFinancing = await tx
              .select({ id: vehicleFinancing.id })
              .from(vehicleFinancing)
              .where(inArray(vehicleFinancing.vehicleId, vehicleIds));

            const financingIds = userFinancing.map((f) => f.id);

            // Delete in correct order (child tables first)
            if (financingIds.length > 0) {
              await tx
                .delete(vehicleFinancingPayments)
                .where(inArray(vehicleFinancingPayments.financingId, financingIds));
            }

            await tx
              .delete(vehicleFinancing)
              .where(inArray(vehicleFinancing.vehicleId, vehicleIds));

            await tx
              .delete(insurancePolicies)
              .where(inArray(insurancePolicies.vehicleId, vehicleIds));

            await tx.delete(expenses).where(inArray(expenses.vehicleId, vehicleIds));
          }

          await tx.delete(vehicles).where(eq(vehicles.userId, userId));
        }

        // Insert sheet data with proper type conversion
        if (sheetData.vehicles.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: Sheet data is dynamic
          await tx
            .insert(vehicles)
            .values(sheetData.vehicles.map((v: any) => convertCSVRow(v)) as any);
        }

        if (sheetData.expenses.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: Sheet data is dynamic
          await tx
            .insert(expenses)
            .values(sheetData.expenses.map((e: any) => convertCSVRow(e)) as any);
        }

        if (sheetData.financing.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: Sheet data is dynamic
          await tx
            .insert(vehicleFinancing)
            .values(sheetData.financing.map((f: any) => convertCSVRow(f)) as any);
        }

        if (sheetData.financingPayments.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: Sheet data is dynamic
          await tx
            .insert(vehicleFinancingPayments)
            .values(sheetData.financingPayments.map((p: any) => convertCSVRow(p)) as any);
        }

        if (sheetData.insurance.length > 0) {
          // biome-ignore lint/suspicious/noExplicitAny: Sheet data is dynamic
          await tx
            .insert(insurancePolicies)
            .values(sheetData.insurance.map((i: any) => convertCSVRow(i)) as any);
        }
      });

      return {
        success: true,
        imported: summary,
      };
    } catch (error) {
      // Handle authentication errors
      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      // Re-throw SyncErrors as-is
      if (error instanceof SyncError) {
        throw error;
      }

      // Wrap other errors
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Failed to restore from Google Sheets',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Validate sheet data types and formats
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Validation requires checking multiple tables and fields
  private validateSheetData(data: {
    vehicles: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
    financing: Record<string, unknown>[];
    financingPayments: Record<string, unknown>[];
    insurance: Record<string, unknown>[];
  }): void {
    // Basic validation - ensure required fields exist
    // This is a simplified validation, could be expanded

    for (const vehicle of data.vehicles) {
      if (!vehicle.id || !vehicle.userId || !vehicle.make || !vehicle.model || !vehicle.year) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Invalid vehicle data in spreadsheet');
      }
    }

    for (const expense of data.expenses) {
      if (!expense.id || !expense.vehicleId || !expense.category || !expense.amount) {
        throw new SyncError(SyncErrorCode.VALIDATION_ERROR, 'Invalid expense data in spreadsheet');
      }
    }

    for (const fin of data.financing) {
      if (!fin.id || !fin.vehicleId || !fin.financingType || !fin.provider) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Invalid financing data in spreadsheet'
        );
      }
    }

    for (const payment of data.financingPayments) {
      if (!payment.id || !payment.financingId || !payment.paymentAmount) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Invalid financing payment data in spreadsheet'
        );
      }
    }

    for (const ins of data.insurance) {
      if (!ins.id || !ins.vehicleId || !ins.company || !ins.totalCost) {
        throw new SyncError(
          SyncErrorCode.VALIDATION_ERROR,
          'Invalid insurance data in spreadsheet'
        );
      }
    }
  }

  /**
   * Upload backup to Google Drive
   */
  async uploadToGoogleDrive(userId: string): Promise<BackupSyncResult> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { users, userSettings } = await import('../db/schema');
    const { GoogleDriveService } = await import('./google-drive');
    const { backupService } = await import('./backup-service');

    const db = databaseService.getDatabase();

    // Get user settings to verify googleDriveBackupEnabled
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    if (!settings.length || !settings[0].googleDriveBackupEnabled) {
      throw new SyncError(
        SyncErrorCode.VALIDATION_ERROR,
        'Google Drive backup is not enabled for this user'
      );
    }

    // Get user info for tokens and name
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user.length || !user[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    try {
      // Create GoogleDriveService instance
      const driveService = new GoogleDriveService(
        user[0].googleRefreshToken,
        user[0].googleRefreshToken
      );

      // Call createVroomFolderStructure to get/create folders
      const folderStructure = await driveService.createVroomFolderStructure(user[0].displayName);

      // Upload to Backups subfolder
      const uploadResult = await backupService.uploadToGoogleDrive(
        userId,
        driveService,
        folderStructure.subFolders.backups.id
      );

      // Call cleanupOldBackups using retention count from settings
      const retentionCount = settings[0].googleDriveBackupRetentionCount || 10;
      await backupService.cleanupOldBackups(
        driveService,
        folderStructure.subFolders.backups.id,
        retentionCount
      );

      // Update lastBackupDate and googleDriveBackupFolderId in user settings
      await db
        .update(userSettings)
        .set({
          lastBackupDate: new Date(),
          googleDriveBackupFolderId: folderStructure.subFolders.backups.id,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));

      // Return file info
      return {
        fileId: uploadResult.fileId,
        fileName: uploadResult.fileName,
        webViewLink: uploadResult.webViewLink,
        lastBackupDate: new Date().toISOString(),
      };
    } catch (error) {
      // Handle authentication errors
      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      // Re-throw SyncErrors as-is
      if (error instanceof SyncError) {
        throw error;
      }

      // Wrap other errors
      throw new SyncError(
        SyncErrorCode.NETWORK_ERROR,
        'Failed to upload backup to Google Drive',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check for existing Google Drive folder structure and backups
   * Does NOT create folders - only checks if they already exist
   * Called when a user logs in to discover existing backups
   */
  async checkExistingGoogleDriveBackups(userId: string): Promise<{
    hasBackupFolder: boolean;
    backupFolderId?: string;
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { users, userSettings } = await import('../db/schema');
    const { GoogleDriveService } = await import('./google-drive');
    const { backupService } = await import('./backup-service');

    const db = databaseService.getDatabase();

    // Get user settings to check if backup folder ID is already stored
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    // If we already have a backup folder ID, use it
    if (settings.length > 0 && settings[0].googleDriveBackupFolderId) {
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!user.length || !user[0].googleRefreshToken) {
        return {
          hasBackupFolder: false,
          existingBackups: [],
        };
      }

      try {
        const driveService = new GoogleDriveService(
          user[0].googleRefreshToken,
          user[0].googleRefreshToken
        );

        // List existing backups in the known backup folder
        const existingBackups = await backupService.listBackupsInDrive(
          driveService,
          settings[0].googleDriveBackupFolderId
        );

        return {
          hasBackupFolder: true,
          backupFolderId: settings[0].googleDriveBackupFolderId,
          existingBackups,
        };
      } catch (error) {
        // If we can't access the folder, it might have been deleted
        console.error('Error accessing backup folder:', error);
        return {
          hasBackupFolder: false,
          existingBackups: [],
        };
      }
    }

    // No backup folder ID stored - check if folder exists in Drive
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user.length || !user[0].googleRefreshToken) {
      return {
        hasBackupFolder: false,
        existingBackups: [],
      };
    }

    try {
      const driveService = new GoogleDriveService(
        user[0].googleRefreshToken,
        user[0].googleRefreshToken
      );

      // Try to find existing VROOM folder (without creating it)
      const folderName = `VROOM Car Tracker - ${user[0].displayName}`;
      const response = await driveService['drive'].files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
      });

      const folders = response.data.files;
      if (!folders || folders.length === 0) {
        // No VROOM folder exists yet
        return {
          hasBackupFolder: false,
          existingBackups: [],
        };
      }

      const mainFolderId = folders[0].id;
      if (!mainFolderId) {
        return {
          hasBackupFolder: false,
          existingBackups: [],
        };
      }

      // Check for Backups subfolder
      const subFolderResponse = await driveService['drive'].files.list({
        q: `'${mainFolderId}' in parents and name='Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
      });

      const backupFolders = subFolderResponse.data.files;
      if (!backupFolders || backupFolders.length === 0) {
        // No Backups folder exists yet
        return {
          hasBackupFolder: false,
          existingBackups: [],
        };
      }

      const backupFolderId = backupFolders[0].id;
      if (!backupFolderId) {
        return {
          hasBackupFolder: false,
          existingBackups: [],
        };
      }

      // Found backup folder - list backups
      const existingBackups = await backupService.listBackupsInDrive(
        driveService,
        backupFolderId
      );

      // Store the backup folder ID for future use
      await db
        .update(userSettings)
        .set({
          googleDriveBackupFolderId: backupFolderId,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));

      return {
        hasBackupFolder: true,
        backupFolderId,
        existingBackups,
      };
    } catch (error) {
      console.error('Error checking for existing backup folder:', error);
      return {
        hasBackupFolder: false,
        existingBackups: [],
      };
    }
  }

  /**
   * Initialize Google Drive folder structure and check for existing backups
   * This DOES create folders if they don't exist
   * Should only be called when user explicitly enables backup sync
   */
  async initializeGoogleDriveForUser(userId: string): Promise<{
    folderStructure: {
      mainFolder: { id: string; name: string; webViewLink?: string };
      subFolders: {
        receipts: { id: string; name: string };
        maintenance: { id: string; name: string };
        photos: { id: string; name: string };
        backups: { id: string; name: string };
      };
    };
    existingBackups: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    }>;
  }> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { users, userSettings } = await import('../db/schema');
    const { GoogleDriveService } = await import('./google-drive');
    const { backupService } = await import('./backup-service');

    const db = databaseService.getDatabase();

    // Get user info for tokens and name
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user.length || !user[0].googleRefreshToken) {
      throw new SyncError(
        SyncErrorCode.AUTH_INVALID,
        'Google Drive access not available. Please re-authenticate with Google.'
      );
    }

    try {
      // Create GoogleDriveService instance
      const driveService = new GoogleDriveService(
        user[0].googleRefreshToken,
        user[0].googleRefreshToken
      );

      // Create or get existing folder structure
      const folderStructure = await driveService.createVroomFolderStructure(user[0].displayName);

      // List existing backups in the backups folder
      const existingBackups = await backupService.listBackupsInDrive(
        driveService,
        folderStructure.subFolders.backups.id
      );

      // Update user settings with folder IDs
      await db
        .update(userSettings)
        .set({
          googleDriveBackupFolderId: folderStructure.subFolders.backups.id,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, userId));

      return {
        folderStructure,
        existingBackups,
      };
    } catch (error) {
      // Handle authentication errors
      if (error instanceof Error && error.message.includes('auth')) {
        throw new SyncError(
          SyncErrorCode.AUTH_INVALID,
          'Google Drive access not available. Please re-authenticate with Google.',
          error.message
        );
      }

      // Wrap other errors
      throw new SyncError(
        SyncErrorCode.NETWORK_ERROR,
        'Failed to initialize Google Drive folder structure',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Auto-restore from the latest Google Drive backup if user has no local data
   * Called during login to automatically restore data for returning users
   */
  async autoRestoreFromLatestBackup(userId: string): Promise<{
    restored: boolean;
    backupInfo?: {
      fileId: string;
      fileName: string;
      createdTime?: string;
    };
    summary?: ImportSummary;
    error?: string;
  }> {
    const { databaseService } = await import('./database');
    const { eq } = await import('drizzle-orm');
    const { users, vehicles } = await import('../db/schema');
    const { GoogleDriveService } = await import('./google-drive');

    const db = databaseService.getDatabase();

    try {
      // Check if user already has local data
      const existingVehicles = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, userId))
        .limit(1);

      // If user has data, don't auto-restore
      if (existingVehicles.length > 0) {
        return {
          restored: false,
          error: 'User already has local data',
        };
      }

      // Check for existing backups (does NOT create folders)
      const { hasBackupFolder, existingBackups } =
        await this.checkExistingGoogleDriveBackups(userId);

      // If no backup folder or no backups exist, nothing to restore
      if (!hasBackupFolder || existingBackups.length === 0) {
        return {
          restored: false,
          error: 'No backups found',
        };
      }

      // Get the latest backup (first in the list, as they're sorted by modified time desc)
      const latestBackup = existingBackups[0];

      // Get user info for tokens
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!user.length || !user[0].googleRefreshToken) {
        return {
          restored: false,
          error: 'Google Drive access not available',
        };
      }

      // Create GoogleDriveService instance
      const driveService = new GoogleDriveService(
        user[0].googleRefreshToken,
        user[0].googleRefreshToken
      );

      // Download the backup file
      const fileBuffer = await driveService.downloadFile(latestBackup.id);

      // Restore from backup in 'replace' mode (safe since user has no data)
      const restoreResult = await this.restoreFromBackup(userId, fileBuffer, 'replace');

      if (restoreResult.success && restoreResult.imported) {
        return {
          restored: true,
          backupInfo: {
            fileId: latestBackup.id,
            fileName: latestBackup.name,
            createdTime: latestBackup.createdTime,
          },
          summary: restoreResult.imported,
        };
      }

      return {
        restored: false,
        error: 'Restore operation failed',
      };
    } catch (error) {
      console.error('Error during auto-restore:', error);
      return {
        restored: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const syncService = new SyncService();
