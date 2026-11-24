import { definePermissions } from '../../permissions/vocabulary';

export const SYNC_PERMISSIONS = definePermissions({
  'account.backup.run': { label: 'Back up and sync your data', scope: 'account' },
  'account.backup.restore': { label: 'Restore your data from a backup', scope: 'account' },
  'account.import.run': { label: 'Import expenses', scope: 'account' },
  'account.export.run': { label: 'Download all your data', scope: 'account' },
});
