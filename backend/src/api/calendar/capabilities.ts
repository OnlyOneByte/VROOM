import { definePermissions } from '../../permissions/vocabulary';

export const CALENDAR_PERMISSIONS = definePermissions({
  'account.calendar.read': { label: 'See your calendar link settings', scope: 'account' },
  'account.calendar.manage': {
    label: 'Create, change and revoke your calendar link',
    scope: 'account',
    implies: ['account.calendar.read'],
  },
});
