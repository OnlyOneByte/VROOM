import { definePermissions } from '../../permissions/vocabulary';

export const DRIVER_PERMISSIONS = definePermissions({
  'vehicle.driver.record': {
    label: 'Record who drove or paid on an entry',
    scope: 'vehicle',
    implies: ['vehicle.read'],
  },
  'vehicle.driver.manage': {
    label: 'Turn car sharing on, manage drivers and set split rules',
    scope: 'vehicle',
    implies: ['vehicle.driver.record', 'vehicle.driver_stats.read'],
  },
  'vehicle.driver_stats.read': {
    label: "See every driver's distance, costs and balance",
    scope: 'vehicle',
    implies: ['vehicle.driver_stats.read_own'],
    sensitive: true,
  },
  'vehicle.driver_stats.read_own': {
    label: 'See their own distance, costs and balance',
    scope: 'vehicle',
  },
});
