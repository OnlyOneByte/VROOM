import { definePermissions } from '../../permissions/vocabulary';

export const ROLE_PERMISSIONS = definePermissions({
  'account.roles.manage': { label: 'Keep your own roles for your vehicles', scope: 'account' },
});
