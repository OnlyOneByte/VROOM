import { definePermissions } from '../../permissions/vocabulary';

export const ODOMETER_PERMISSIONS = definePermissions({
  'vehicle.odometer.read': { label: 'See odometer readings', scope: 'vehicle' },
  'vehicle.odometer.write': {
    label: 'Add and edit odometer readings',
    scope: 'vehicle',
    implies: ['vehicle.odometer.read'],
  },
  'vehicle.odometer.delete': {
    label: 'Delete any odometer reading',
    scope: 'vehicle',
    implies: ['vehicle.odometer.read'],
  },
  'vehicle.odometer.delete_own': {
    label: 'Delete their own odometer readings',
    scope: 'vehicle',
    implies: ['vehicle.odometer.read'],
  },
});
