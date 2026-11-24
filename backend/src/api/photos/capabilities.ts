import { definePermissions } from '../../permissions/vocabulary';

export const PHOTO_PERMISSIONS = definePermissions({
  'vehicle.photo.read': { label: 'See photos', scope: 'vehicle' },
  'vehicle.photo.write': {
    label: 'Add and edit photos',
    scope: 'vehicle',
    implies: ['vehicle.photo.read'],
  },
  'vehicle.photo.delete': {
    label: 'Delete any photo',
    scope: 'vehicle',
    implies: ['vehicle.photo.read'],
  },
  'vehicle.photo.delete_own': {
    label: 'Delete their own photos',
    scope: 'vehicle',
    implies: ['vehicle.photo.read'],
  },
});
