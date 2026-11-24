import { definePermissions } from '../../permissions/vocabulary';

export const PROVIDER_PERMISSIONS = definePermissions({
  'account.provider.manage': {
    label: 'Connect and manage storage and AI providers',
    scope: 'account',
  },
});
