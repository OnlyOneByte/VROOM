import { definePermissions } from '../../permissions/vocabulary';

export const SETTINGS_PERMISSIONS = definePermissions({
  'account.settings.read': { label: 'See your settings', scope: 'account' },
  'account.settings.write': {
    label: 'Change your settings',
    scope: 'account',
    implies: ['account.settings.read'],
  },
});
