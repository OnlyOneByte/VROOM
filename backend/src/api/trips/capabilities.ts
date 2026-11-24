import { definePermissions } from '../../permissions/vocabulary';

export const TRIP_PERMISSIONS = definePermissions({
  'vehicle.trip.read': { label: 'See trips', scope: 'vehicle' },
  'vehicle.trip.write': {
    label: 'Add and edit trips',
    scope: 'vehicle',
    implies: ['vehicle.trip.read'],
  },
  'vehicle.trip.delete': {
    label: 'Delete any trip',
    scope: 'vehicle',
    implies: ['vehicle.trip.read'],
  },
  'vehicle.trip.delete_own': {
    label: 'Delete their own trips',
    scope: 'vehicle',
    implies: ['vehicle.trip.read'],
  },
});
