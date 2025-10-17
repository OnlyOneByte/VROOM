# Change Tracking for Sync Optimization

## Overview

The change tracking system optimizes Google Drive/Sheets sync operations by only performing syncs when there are actual data changes. This significantly reduces unnecessary API calls and improves performance.

## How It Works

### 1. Change Detection

The system tracks two timestamps in the `user_settings` table:
- `lastDataChangeDate`: When user data was last modified
- `lastSyncDate`: When the last sync operation completed

### 2. Automatic Change Tracking

The `trackDataChanges` middleware automatically marks data as changed when:
- Any POST, PUT, PATCH, or DELETE request succeeds (2xx status)
- The request is made to data modification routes (vehicles, expenses, financing, insurance)

### 3. Sync Optimization

Before performing an auto-sync:
1. The system checks if `lastDataChangeDate > lastSyncDate`
2. If no changes detected, the sync is skipped
3. If changes exist, the sync proceeds normally

## Benefits

- **Reduced API Calls**: No unnecessary calls to Google Drive/Sheets when just browsing
- **Better Performance**: Faster response times when no sync is needed
- **Cost Savings**: Fewer API quota usage
- **Battery Life**: Less network activity on mobile devices

## Implementation Details

### Change Tracker Service

Located in `backend/src/lib/change-tracker.ts`:

```typescript
// Mark data as changed
await changeTracker.markDataChanged(userId);

// Check if changes exist
const hasChanges = await changeTracker.hasChangesSinceLastSync(userId);

// Get detailed status
const status = await changeTracker.getChangeStatus(userId);
```

### Middleware

Located in `backend/src/lib/middleware/change-tracker.ts`:

The middleware automatically tracks changes on successful mutations:

```typescript
// Applied to all data routes
vehicles.use('*', trackDataChanges);
expenses.use('*', trackDataChanges);
financing.use('*', trackDataChanges);
insurance.use('*', trackDataChanges);
```

### Activity Tracker Integration

The activity tracker checks for changes before triggering auto-sync:

```typescript
// In activity-tracker.ts
const hasChanges = await changeTracker.hasChangesSinceLastSync(userId);
if (!hasChanges) {
  console.log('Auto-sync skipped: No changes since last sync');
  return;
}
```

## API Endpoints

### GET /api/sync/status

Returns sync status including change information:

```json
{
  "success": true,
  "status": {
    "googleSheetsSyncEnabled": true,
    "googleDriveBackupEnabled": true,
    "lastSyncDate": "2024-10-17T10:30:00Z",
    "lastDataChangeDate": "2024-10-17T11:00:00Z",
    "hasChangesSinceLastSync": true,
    "syncInProgress": false
  }
}
```

### POST /api/sync

Manual sync now includes change information:

```json
{
  "success": true,
  "results": { ... },
  "hasChangesSinceLastSync": true,
  "message": "Sync completed successfully"
}
```

## Database Schema

New field in `user_settings` table:

```sql
ALTER TABLE `user_settings` 
ADD `last_data_change_date` integer;
```

## Testing

To test the change tracking:

1. **No Changes Scenario**:
   - Perform a sync
   - Browse data without modifications
   - Wait for auto-sync trigger
   - Verify sync is skipped in logs

2. **With Changes Scenario**:
   - Perform a sync
   - Add/edit/delete a vehicle or expense
   - Wait for auto-sync trigger
   - Verify sync proceeds normally

3. **Manual Sync**:
   - Check `/api/sync/status` for `hasChangesSinceLastSync`
   - Trigger manual sync via `/api/sync`
   - Verify response includes change status

## Logging

The system logs change tracking events:

```
Data change marked for user <userId>
Auto-sync skipped for user <userId>: No changes since last sync
Auto-sync starting for user <userId> (changes detected)
```

## Edge Cases

1. **First Sync**: If no `lastSyncDate` exists, changes are assumed
2. **No Change Date**: If no `lastDataChangeDate` exists, changes are assumed
3. **Error Handling**: On errors, the system assumes changes exist (fail-safe)

## Future Enhancements

Potential improvements:
- Track changes per sync type (sheets vs backup)
- Track changes per table for granular sync
- Add change counters for metrics
- Implement change batching for high-frequency updates
