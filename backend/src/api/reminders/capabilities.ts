import { definePermissions } from '../../permissions/vocabulary';

export const REMINDER_PERMISSIONS = definePermissions({
  'vehicle.reminder.read': { label: 'See reminders', scope: 'vehicle' },
  'vehicle.reminder.write': {
    label: 'Add and edit reminders',
    scope: 'vehicle',
    implies: ['vehicle.reminder.read'],
  },
  'vehicle.reminder.delete': {
    label: 'Delete any reminder',
    scope: 'vehicle',
    implies: ['vehicle.reminder.read'],
  },
  'vehicle.reminder.delete_own': {
    label: 'Delete their own reminders',
    scope: 'vehicle',
    implies: ['vehicle.reminder.read'],
  },
});
