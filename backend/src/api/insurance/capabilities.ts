import { definePermissions } from '../../permissions/vocabulary';

export const INSURANCE_PERMISSIONS = definePermissions({
  'vehicle.insurance.read': {
    label: 'See insurance policies and claims',
    scope: 'vehicle',
    sensitive: true,
  },
  'vehicle.insurance.write': {
    label: 'Change insurance policies and claims',
    scope: 'vehicle',
    implies: ['vehicle.insurance.read'],
  },
});
