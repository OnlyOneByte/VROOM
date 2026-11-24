import { definePermissions } from '../../permissions/vocabulary';

export const COMMUNITY_PERMISSIONS = definePermissions({
  'vehicle.community.read': { label: 'See community comparisons', scope: 'vehicle' },
  'vehicle.community.manage': {
    label: 'Share the vehicle in community stats',
    scope: 'vehicle',
    implies: ['vehicle.community.read'],
  },
});
