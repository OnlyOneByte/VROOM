import { definePermissions } from '../../permissions/vocabulary';

export const FINANCING_PERMISSIONS = definePermissions({
  'vehicle.financing.read': {
    label: 'See loan and lease details',
    scope: 'vehicle',
    sensitive: true,
  },
  'vehicle.financing.write': {
    label: 'Change loan and lease details',
    scope: 'vehicle',
    implies: ['vehicle.financing.read'],
  },
});
