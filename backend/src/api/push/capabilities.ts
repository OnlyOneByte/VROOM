import { definePermissions } from '../../permissions/vocabulary';

export const PUSH_PERMISSIONS = definePermissions({
  'account.push.read': { label: 'See push notification setup', scope: 'account' },
  'account.push.write': {
    label: 'Turn push notifications on or off',
    scope: 'account',
    implies: ['account.push.read'],
  },
});
