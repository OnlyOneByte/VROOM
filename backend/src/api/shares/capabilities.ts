import { definePermissions } from '../../permissions/vocabulary';

export const SHARE_PERMISSIONS = definePermissions({
  'vehicle.share.read': { label: 'See who has access', scope: 'vehicle' },
  'vehicle.share.manage': {
    label: 'Invite people and change their access',
    scope: 'vehicle',
    implies: ['vehicle.share.read'],
  },
  'account.share.read': { label: 'See vehicles shared with you', scope: 'account' },
  'account.share.manage': {
    label: 'Accept or leave vehicles shared with you',
    scope: 'account',
    implies: ['account.share.read'],
  },
});
