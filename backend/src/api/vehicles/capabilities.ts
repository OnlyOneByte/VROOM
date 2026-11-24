import { definePermissions } from '../../permissions/vocabulary';

export const VEHICLE_PERMISSIONS = definePermissions({
  'vehicle.read': { label: 'See the vehicle', scope: 'vehicle' },
  'vehicle.write': {
    label: 'Edit vehicle details',
    scope: 'vehicle',
    implies: ['vehicle.read'],
  },
  'vehicle.delete': {
    label: 'Delete the vehicle',
    scope: 'vehicle',
    grantable: false,
    implies: ['vehicle.read'],
  },
  'vehicle.transfer': {
    label: 'Transfer ownership',
    scope: 'vehicle',
    grantable: false,
    implies: ['vehicle.read'],
  },
  'account.vehicle.write': { label: 'Add vehicles', scope: 'account' },
});
