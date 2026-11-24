import { definePermissions } from '../../permissions/vocabulary';

export const ACCOUNT_PERMISSIONS = definePermissions({
  'account.profile.read': { label: 'See your profile', scope: 'account' },
  'account.profile.write': {
    label: 'Edit your profile',
    scope: 'account',
    implies: ['account.profile.read'],
  },
  'account.signin.manage': { label: 'Link and unlink sign-in methods', scope: 'account' },
  'account.session.manage': { label: 'Refresh and sign out sessions', scope: 'account' },
  'account.delete': { label: 'Delete your account', scope: 'account' },
});
