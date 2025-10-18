# Sync Service Architecture

## Before Refactoring

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/Svelte)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              /api/backup-and-sync (680+ lines)               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  • Sync orchestration                                │   │
│  │  • Backup management                                 │   │
│  │  • Restore operations                                │   │
│  │  • Drive initialization                              │   │
│  │  • Error handling (duplicated)                       │   │
│  │  • Rate limiting (mixed)                             │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────┬──────────────┬──────────────┬───────────────────┘
            │              │              │
            ▼              ▼              ▼
    ┌───────────┐  ┌──────────────┐  ┌──────────────┐
    │  Backup   │  │    Restore   │  │  Drive Sync  │
    │  Creator  │  │   Executor   │  │              │
    └───────────┘  └──────────────┘  └──────────────┘
```

**Issues:**
- ❌ Single 680+ line file with mixed concerns
- ❌ Routes directly call multiple services (bypassing orchestrator)
- ❌ Inconsistent error handling
- ❌ Unclear API structure

---

## After Refactoring

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React/Svelte)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      /api/sync Routes                        │
│                                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │  index.ts      │  │  backups.ts    │  │  restore.ts  │   │
│  │  (240 lines)   │  │  (340 lines)   │  │  (200 lines) │   │
│  ├────────────────┤  ├────────────────┤  ├──────────────┤   │
│  │ • POST /       │  │ • GET /        │  │ • POST       │   │
│  │ • GET /status  │  │ • GET /download│  │   /from-     │   │
│  │ • POST         │  │ • GET /:id/    │  │   backup     │   │
│  │   /configure   │  │   download     │  │ • POST       │   │
│  │                │  │ • DELETE /:id  │  │   /from-     │   │
│  │                │  │ • POST         │  │   sheets     │   │
│  │                │  │   /initialize- │  │ • POST /auto │   │
│  │                │  │   drive        │  │              │   │
│  └────────┬───────┘  └────────┬───────┘  └──────┬───────┘   │
│           │                   │                  │           │
└───────────┼───────────────────┼──────────────────┼───────────┘
            │                   │                  │
            └───────────────────┼──────────────────┘
                                ▼
                    ┌───────────────────────┐
                    │   Sync Orchestrator   │
                    │   (Single Entry Point)│
                    ├───────────────────────┤
                    │ • createBackup()      │
                    │ • exportBackupAsZip() │
                    │ • uploadBackupToDrive()│
                    │ • listDriveBackups()  │
                    │ • initializeDrive()   │
                    │ • restoreFromBackup() │
                    │ • restoreFromSheets() │
                    │ • autoRestore()       │
                    │ • syncToSheets()      │
                    └───────────┬───────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌───────────┐   ┌──────────────┐   ┌──────────────┐
        │  Backup   │   │   Restore    │   │  Drive Sync  │
        │  Creator  │   │   Executor   │   │              │
        └───────────┘   └──────────────┘   └──────────────┘
                │               │                   │
                ▼               ▼                   ▼
        ┌───────────┐   ┌──────────────┐   ┌──────────────┐
        │  Backup   │   │   Conflict   │   │   Sheets     │
        │  Parser   │   │   Detector   │   │   Sync       │
        └───────────┘   └──────────────┘   └──────────────┘
                │               │
                ▼               ▼
        ┌───────────┐   ┌──────────────┐
        │  Backup   │   │     Data     │
        │ Validator │   │   Importer   │
        └───────────┘   └──────────────┘
```

**Benefits:**
- ✅ Clear separation of concerns (3 focused files)
- ✅ All operations go through orchestrator
- ✅ Consistent error handling
- ✅ RESTful API structure
- ✅ Proper abstraction layers

---

## Request Flow Example

### Creating and Uploading a Backup

```
Frontend
   │
   │ POST /api/sync
   │ { syncTypes: ['backup'] }
   │
   ▼
┌──────────────────────────────────┐
│  Route: /api/sync (index.ts)     │
│  • Validate request               │
│  • Check sync lock                │
│  • Apply rate limiting            │
└──────────────┬───────────────────┘
               │
               │ syncOrchestrator.executeSync(userId, ['backup'])
               │
               ▼
┌──────────────────────────────────┐
│  Sync Orchestrator                │
│  • Coordinate sync operations     │
└──────────────┬───────────────────┘
               │
               │ driveSync.uploadBackupToGoogleDrive(userId)
               │
               ▼
┌──────────────────────────────────┐
│  Drive Sync Service               │
│  • Get user settings              │
│  • Validate Drive enabled         │
└──────────────┬───────────────────┘
               │
               │ backupCreator.exportAsZip(userId)
               │
               ▼
┌──────────────────────────────────┐
│  Backup Creator Service           │
│  • Fetch user data                │
│  • Convert to CSV                 │
│  • Create ZIP archive             │
└──────────────┬───────────────────┘
               │
               │ return Buffer
               │
               ▼
┌──────────────────────────────────┐
│  Drive Sync Service               │
│  • Upload to Google Drive         │
│  • Clean up old backups           │
│  • Update last backup date        │
└──────────────┬───────────────────┘
               │
               │ return { fileId, fileName, webViewLink }
               │
               ▼
┌──────────────────────────────────┐
│  Sync Orchestrator                │
│  • Collect results                │
│  • Handle errors                  │
└──────────────┬───────────────────┘
               │
               │ return { success, results }
               │
               ▼
┌──────────────────────────────────┐
│  Route: /api/sync                 │
│  • Format response                │
│  • Release sync lock              │
└──────────────┬───────────────────┘
               │
               │ JSON response
               │
               ▼
            Frontend
```

---

## Error Handling Flow

```
┌──────────────────────────────────┐
│  Any Service Layer                │
│  throw new SyncError(             │
│    SyncErrorCode.AUTH_INVALID,    │
│    'Message',                     │
│    details                        │
│  )                                │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Sync Orchestrator                │
│  • Propagate error                │
│  • Add context if needed          │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Route Handler                    │
│  • Catch error                    │
│  • Map error code to HTTP status  │
│  • Use createErrorResponse()      │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Error Response                   │
│  {                                │
│    success: false,                │
│    error: {                       │
│      code: 'AUTH_INVALID',        │
│      message: '...',              │
│      details: {...}               │
│    }                              │
│  }                                │
└──────────────┬───────────────────┘
               │
               ▼
            Frontend
```

---

## Rate Limiting Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      Rate Limiters                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  syncRateLimiter                                             │
│  • Window: 15 minutes                                        │
│  • Limit: 5 requests                                         │
│  • Applied to: POST /api/sync                                │
│                                                               │
│  backupRateLimiter                                           │
│  • Window: 5 minutes                                         │
│  • Limit: 10 requests                                        │
│  • Applied to: GET /backups/download, POST /backups/upload   │
│                                                               │
│  driveInitRateLimiter                                        │
│  • Window: 10 minutes                                        │
│  • Limit: 3 requests                                         │
│  • Applied to: POST /backups/initialize-drive                │
│                                                               │
│  restoreRateLimiter                                          │
│  • Window: 10 minutes                                        │
│  • Limit: 5 requests                                         │
│  • Applied to: POST /restore/*                               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Architectural Principles

### 1. Single Responsibility Principle
Each route file handles one aspect:
- `index.ts`: Sync orchestration and configuration
- `backups.ts`: Backup CRUD operations
- `restore.ts`: Data restoration operations

### 2. Orchestrator Pattern
All operations flow through `SyncOrchestrator`:
- Routes never directly call service implementations
- Orchestrator coordinates between services
- Easy to add cross-cutting concerns (logging, metrics, etc.)

### 3. Layered Architecture
```
Routes (HTTP) → Orchestrator (Coordination) → Services (Business Logic) → Repositories (Data Access)
```

### 4. Error Handling
- Services throw typed errors (`SyncError`)
- Orchestrator propagates with context
- Routes map to HTTP status codes
- Consistent error response format

### 5. Rate Limiting
- Different limits for different operation types
- User-specific rate limiting
- Appropriate time windows for each operation

---

## Testing Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      Test Pyramid                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  E2E Tests (Future)                                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Full user flows                                    │    │
│  │ • Frontend → Backend → Database → External APIs     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  Integration Tests (Current)                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Test through orchestrator                          │    │
│  │ • Real database operations                           │    │
│  │ • Mock external APIs (Google Drive/Sheets)          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  Unit Tests (Current)                                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Individual service methods                         │    │
│  │ • Validation logic                                   │    │
│  │ • Error handling                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

All tests now use the orchestrator, ensuring we test the actual code paths used in production.
