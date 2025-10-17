# Design Document

## Overview

This design consolidates the existing fragmented Google Drive integration into a unified sync system with two primary capabilities:

1. **Manual Backup/Restore** - Direct download/upload of ZIP files containing user data
2. **Automated Sync** - Inactivity-based sync to Google Sheets and/or Google Drive backups

The system will replace the existing `/api/sheets`, `/api/backup`, and `/api/drive` routes with a single `/api/sync` endpoint that provides a clean, extensible API surface.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Settings   │  │   Backup     │  │   Restore    │      │
│  │     UI       │  │   Download   │  │    Upload    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          │                  │                  │
┌─────────┼──────────────────┼──────────────────┼─────────────┐
│         │                  │                  │              │
│         ▼                  ▼                  ▼              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           /api/sync Routes (Hono)                    │   │
│  │  • POST /sync                                        │   │
│  │  • GET /sync/status                                  │   │
│  │  • POST /sync/configure                              │   │
│  │  • GET /sync/download                                │   │
│  │  • POST /sync/upload                                 │   │
│  │  • GET /sync/backups                                 │   │
│  │  • DELETE /sync/backups/:fileId                      │   │
│  │  • POST /sync/restore-from-sheets                    │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           SyncService (Core Logic)                   │   │
│  │  • executeSync(userId, syncTypes[])                  │   │
│  │  • generateBackup(userId)                            │   │
│  │  • restoreFromBackup(userId, file, mode)             │   │
│  │  • syncToSheets(userId)                              │   │
│  │  • restoreFromSheets(userId)                         │   │
│  └──────┬────────────────────────┬──────────────────────┘   │
│         │                        │                           │
│         ▼                        ▼                           │
│  ┌──────────────┐        ┌──────────────┐                   │
│  │   Backup     │        │   Sheets     │                   │
│  │   Service    │        │   Service    │                   │
│  └──────┬───────┘        └──────┬───────┘                   │
│         │                       │                            │
│         └───────────┬───────────┘                            │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         GoogleDriveService                           │   │
│  │  • createVroomFolderStructure()                      │   │
│  │  • uploadFile()                                      │   │
│  │  • listFilesInFolder()                               │   │
│  │  • deleteFile()                                      │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │  Google Drive    │
            │  Google Sheets   │
            │      APIs        │
            └──────────────────┘
```

### Activity Tracking for Auto-Sync

```
┌─────────────────────────────────────────────────────────────┐
│                   Activity Tracker                           │
│                                                              │
│  User Activity Map:                                          │
│  ┌────────────────────────────────────────────────────┐     │
│  │ userId → {                                         │     │
│  │   lastActivity: Date                               │     │
│  │   inactivityTimer: NodeJS.Timeout                  │     │
│  │   syncInProgress: boolean                          │     │
│  │ }                                                  │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  On User Activity:                                           │
│  1. Reset inactivity timer                                   │
│  2. Schedule sync after N minutes                            │
│                                                              │
│  On Inactivity Timeout:                                      │
│  1. Check enabled sync types from user settings              │
│  2. Call SyncService.executeSync(userId, syncTypes)          │
│  3. Mark sync complete                                       │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Sync Routes (`backend/src/routes/sync.ts`)

New Hono router that handles all sync-related endpoints.

```typescript
interface SyncRequest {
  syncTypes: ('sheets' | 'backup')[]; // Extensible array
}

interface SyncResponse {
  success: boolean;
  results: {
    sheets?: {
      spreadsheetId: string;
      webViewLink: string;
      lastSyncDate: string;
    };
    backup?: {
      fileId: string;
      fileName: string;
      webViewLink: string;
      lastBackupDate: string;
    };
  };
  errors?: {
    sheets?: string;
    backup?: string;
  };
}

interface SyncConfigRequest {
  googleSheetsSyncEnabled: boolean;
  googleDriveBackupEnabled: boolean;
  syncInactivityMinutes: number;
}

interface RestoreRequest {
  mode: 'replace' | 'merge' | 'preview';
}

interface RestoreResponse {
  success: boolean;
  preview?: {
    vehicles: number;
    expenses: number;
    financing: number;
    financingPayments: number;
    insurance: number;
  };
  imported?: {
    vehicles: number;
    expenses: number;
    financing: number;
    financingPayments: number;
    insurance: number;
  };
  conflicts?: Array<{
    table: string;
    id: string;
    localData: unknown;
    remoteData: unknown;
  }>;
}
```

### 2. Sync Service (`backend/src/lib/sync-service.ts`)

Core service that orchestrates all sync operations.

```typescript
class SyncService {
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
  }>;

  /**
   * Generate backup ZIP file
   */
  async generateBackup(userId: string): Promise<Buffer>;

  /**
   * Restore from backup file
   */
  async restoreFromBackup(
    userId: string,
    file: Buffer,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResult>;

  /**
   * Sync data to Google Sheets
   */
  async syncToSheets(userId: string): Promise<SheetsSyncResult>;

  /**
   * Restore data from Google Sheets
   */
  async restoreFromSheets(
    userId: string,
    mode: 'replace' | 'merge' | 'preview'
  ): Promise<RestoreResult>;

  /**
   * Validate backup file structure and version
   */
  private validateBackupFile(file: Buffer): BackupMetadata;

  /**
   * Detect conflicts between local and remote data
   */
  private detectConflicts(
    localData: BackupData,
    remoteData: BackupData
  ): Conflict[];
}
```

### 3. Refactored Backup Service (`backend/src/lib/backup-service.ts`)

Simplified to only handle ZIP format backups.

```typescript
interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
}

interface BackupData {
  metadata: BackupMetadata;
  vehicles: Vehicle[];
  expenses: Expense[];
  financing: VehicleFinancing[];
  financingPayments: VehicleFinancingPayment[];
  insurance: InsurancePolicy[];
}

class BackupService {
  /**
   * Create backup data structure
   */
  async createBackup(userId: string): Promise<BackupData>;

  /**
   * Export backup as ZIP file
   */
  async exportAsZip(userId: string): Promise<Buffer>;

  /**
   * Parse ZIP file into backup data
   */
  async parseZipBackup(file: Buffer): Promise<BackupData>;

  /**
   * Upload backup to Google Drive
   */
  async uploadToGoogleDrive(
    userId: string,
    driveService: GoogleDriveService,
    backupFolderId: string
  ): Promise<{ fileId: string; fileName: string; webViewLink: string }>;

  /**
   * List backups in Google Drive
   */
  async listBackupsInDrive(
    driveService: GoogleDriveService,
    backupFolderId: string
  ): Promise<BackupFileInfo[]>;

  /**
   * Cleanup old backups (keep last N)
   */
  async cleanupOldBackups(
    driveService: GoogleDriveService,
    backupFolderId: string,
    keepCount: number
  ): Promise<number>;
}
```

### 4. Refactored Sheets Service (`backend/src/lib/google-sheets.ts`)

Simplified to match database structure without dashboards.

```typescript
class GoogleSheetsService {
  /**
   * Create or update VROOM spreadsheet
   */
  async createOrUpdateVroomSpreadsheet(
    userId: string,
    userName: string
  ): Promise<SpreadsheetInfo>;

  /**
   * Update spreadsheet with user data
   */
  private async updateSpreadsheetWithUserData(
    spreadsheetId: string,
    userId: string
  ): Promise<void>;

  /**
   * Update individual sheet (vehicles, expenses, etc.)
   */
  private async updateSheet(
    spreadsheetId: string,
    sheetName: string,
    data: unknown[]
  ): Promise<void>;

  /**
   * Read data from spreadsheet
   */
  async readSpreadsheetData(
    spreadsheetId: string
  ): Promise<BackupData>;

  /**
   * Get spreadsheet info
   */
  async getSpreadsheetInfo(spreadsheetId: string): Promise<SpreadsheetInfo>;
}
```

### 5. Google Drive Service (`backend/src/lib/google-drive.ts`)

Remains largely the same, handles folder management and file operations.

```typescript
class GoogleDriveService {
  /**
   * Create VROOM folder structure
   */
  async createVroomFolderStructure(userName: string): Promise<FolderStructure>;

  /**
   * Upload file to Drive
   */
  async uploadFile(
    fileName: string,
    fileContent: Buffer,
    mimeType: string,
    parentFolderId?: string
  ): Promise<DriveFile>;

  /**
   * List files in folder
   */
  async listFilesInFolder(folderId: string): Promise<DriveFile[]>;

  /**
   * Delete file
   */
  async deleteFile(fileId: string): Promise<void>;
}
```

## Data Models

### Backup File Structure (ZIP)

```
vroom-backup-2025-01-17T10-30-00-000Z.zip
├── metadata.json
├── vehicles.csv
├── expenses.csv
├── insurance_policies.csv
├── vehicle_financing.csv
└── vehicle_financing_payments.csv
```

### metadata.json

```json
{
  "version": "1.0.0",
  "timestamp": "2025-01-17T10:30:00.000Z",
  "userId": "user_abc123"
}
```

### CSV Format

Each CSV file contains all columns from the corresponding database table:

**vehicles.csv**
```csv
id,userId,make,model,year,licensePlate,nickname,initialMileage,purchasePrice,purchaseDate,createdAt,updatedAt
```

**expenses.csv**
```csv
id,vehicleId,tags,category,amount,currency,date,mileage,gallons,description,receiptUrl,createdAt,updatedAt
```

**insurance_policies.csv**
```csv
id,vehicleId,company,policyNumber,totalCost,termLengthMonths,startDate,endDate,monthlyCost,isActive,createdAt,updatedAt
```

**vehicle_financing.csv**
```csv
id,vehicleId,financingType,provider,originalAmount,currentBalance,apr,termMonths,startDate,paymentAmount,paymentFrequency,paymentDayOfMonth,paymentDayOfWeek,residualValue,mileageLimit,excessMileageFee,isActive,endDate,createdAt,updatedAt
```

**vehicle_financing_payments.csv**
```csv
id,financingId,paymentDate,paymentAmount,principalAmount,interestAmount,remainingBalance,paymentNumber,paymentType,isScheduled,createdAt,updatedAt
```

### Google Sheets Structure

Spreadsheet: "VROOM Data - {userName}"

**Sheets:**
1. **Vehicles** - All vehicle columns
2. **Expenses** - All expense columns
3. **Insurance Policies** - All insurance columns
4. **Vehicle Financing** - All financing columns (loans, leases, owned)
5. **Vehicle Financing Payments** - All financing payment columns

Each sheet has:
- Row 1: Column headers matching database field names
- Row 2+: Data rows

### Database Schema Updates

The existing `userSettings` table already has the necessary fields:

```typescript
{
  // Backup preferences
  autoBackupEnabled: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
  lastBackupDate: Date | null;
  googleDriveBackupEnabled: boolean;
  googleDriveBackupFolderId: string | null;
  
  // Sync preferences
  googleSheetsSyncEnabled: boolean;
  googleSheetsSpreadsheetId: string | null;
  syncOnInactivity: boolean;
  syncInactivityMinutes: number; // default: 5
  lastSyncDate: Date | null;
}
```

No schema changes required.

## Error Handling

### Error Types

```typescript
enum SyncErrorCode {
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

class SyncError extends Error {
  constructor(
    public code: SyncErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}
```

### Error Responses

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: SyncErrorCode;
    message: string;
    details?: unknown;
  };
}
```

### HTTP Status Codes

- `400` - Validation errors, invalid file format
- `401` - Authentication invalid/expired
- `403` - Permission denied
- `409` - Sync in progress, conflicts detected
- `429` - Quota exceeded
- `500` - Internal server error, network issues

## Testing Strategy

### Unit Tests

1. **BackupService**
   - Test ZIP creation with all data types
   - Test ZIP parsing and validation
   - Test metadata validation
   - Test CSV generation for each table

2. **SyncService**
   - Test executeSync with different syncTypes combinations
   - Test conflict detection logic
   - Test restore modes (replace, merge, preview)
   - Test validation logic

3. **GoogleSheetsService**
   - Test spreadsheet creation
   - Test data formatting for sheets
   - Test data reading from sheets
   - Test sheet updates

4. **GoogleDriveService**
   - Test folder structure creation
   - Test file upload/download
   - Test file listing and cleanup

### Integration Tests

1. **End-to-End Backup/Restore**
   - Create backup → Download → Upload → Restore
   - Verify data integrity

2. **Sheets Sync**
   - Sync to sheets → Modify sheets → Restore from sheets
   - Verify conflict detection

3. **Auto-Sync**
   - Trigger inactivity → Verify sync execution
   - Test activity reset

4. **Error Scenarios**
   - Invalid auth tokens
   - Network failures
   - Quota limits
   - Invalid file formats

### Manual Testing Checklist

- [ ] Download backup file
- [ ] Upload and restore backup (replace mode)
- [ ] Upload and restore backup (merge mode with conflicts)
- [ ] Sync to Google Sheets
- [ ] Modify data in Google Sheets
- [ ] Restore from Google Sheets
- [ ] Configure sync settings
- [ ] Test auto-sync after inactivity
- [ ] Test manual sync trigger
- [ ] Verify folder structure in Google Drive
- [ ] Test backup cleanup (keep last 10)
- [ ] Test error messages for various failure scenarios

## Security Considerations

1. **Authentication**
   - All endpoints require valid user authentication
   - Google OAuth tokens validated before Drive/Sheets operations

2. **Authorization**
   - Users can only access their own data
   - Vehicle ownership verified before operations

3. **Data Validation**
   - Backup files validated for structure and version
   - CSV data validated before import
   - Metadata checked for userId match

4. **File Size Limits**
   - Backup files limited to reasonable size (e.g., 50MB)
   - Multipart upload with size validation

5. **Rate Limiting**
   - Existing rate limiter applies to all sync endpoints
   - Additional sync-in-progress check prevents concurrent syncs

## Performance Considerations

1. **Parallel Execution**
   - Multiple sync types execute in parallel
   - Use Promise.all() for concurrent operations

2. **Streaming**
   - Large files streamed rather than loaded into memory
   - ZIP creation uses streaming

3. **Caching**
   - Folder IDs cached in user settings
   - Spreadsheet IDs cached to avoid lookups

4. **Batch Operations**
   - Google Sheets updates batched where possible
   - Drive file operations batched

5. **Background Processing**
   - Auto-sync runs in background
   - Activity tracker uses efficient timers

## Migration Plan

### Phase 1: Cleanup (Priority: Critical)
1. Delete `backend/src/routes/sheets.ts`
2. Delete `backend/src/routes/backup.ts`
3. Delete `backend/src/routes/drive.ts` (if exists)
4. Remove route registrations from `backend/src/index.ts`
5. Verify application compiles

### Phase 2: Manual Backup/Restore (Priority: High)
1. Create `backend/src/lib/sync-service.ts`
2. Refactor `backup-service.ts` to only support ZIP
3. Create `backend/src/routes/sync.ts` with download/upload endpoints
4. Implement validation and restore logic
5. Add route registration
6. Test backup/restore flow

### Phase 3: Automated Sync (Priority: Medium)
1. Refactor `google-sheets.ts` to remove dashboards
2. Implement sheets sync in `sync-service.ts`
3. Add sync endpoints to `sync.ts`
4. Update activity tracker to call new sync service
5. Test auto-sync flow

### Phase 4: Frontend Updates (Priority: Medium)
1. Update frontend to use new `/api/sync` endpoints
2. Remove references to old endpoints
3. Update UI for new sync configuration
4. Test end-to-end flows

### Phase 5: Service Refactoring (Priority: Low)
1. Consolidate shared logic
2. Remove unused code from services
3. Update documentation
4. Final cleanup

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sync/download` | Download backup ZIP file |
| POST | `/api/sync/upload` | Upload and restore backup file |
| POST | `/api/sync` | Trigger sync for specified types |
| GET | `/api/sync/status` | Get sync configuration and status |
| POST | `/api/sync/configure` | Update sync settings |
| GET | `/api/sync/backups` | List backups in Google Drive |
| DELETE | `/api/sync/backups/:fileId` | Delete specific backup |
| POST | `/api/sync/restore-from-sheets` | Restore data from Google Sheets |
