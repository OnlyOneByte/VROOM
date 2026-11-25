import { ASSISTANT_PERMISSIONS } from '../api/assistant/capabilities';
import { ACCOUNT_PERMISSIONS } from '../api/auth/capabilities';
import { CALENDAR_PERMISSIONS } from '../api/calendar/capabilities';
import { COMMUNITY_PERMISSIONS } from '../api/community/capabilities';
import { DRIVER_PERMISSIONS } from '../api/drivers/capabilities';
import { EXPENSE_PERMISSIONS } from '../api/expenses/capabilities';
import { FINANCING_PERMISSIONS } from '../api/financing/capabilities';
import { INSURANCE_PERMISSIONS } from '../api/insurance/capabilities';
import { ODOMETER_PERMISSIONS } from '../api/odometer/capabilities';
import { PHOTO_PERMISSIONS } from '../api/photos/capabilities';
import { PROVIDER_PERMISSIONS } from '../api/providers/capabilities';
import { PUSH_PERMISSIONS } from '../api/push/capabilities';
import { REMINDER_PERMISSIONS } from '../api/reminders/capabilities';
import { ROLE_PERMISSIONS } from '../api/roles/capabilities';
import { SETTINGS_PERMISSIONS } from '../api/settings/capabilities';
import { SHARE_PERMISSIONS } from '../api/shares/capabilities';
import { SYNC_PERMISSIONS } from '../api/sync/capabilities';
import { TRIP_PERMISSIONS } from '../api/trips/capabilities';
import { VEHICLE_PERMISSIONS } from '../api/vehicles/capabilities';
import { buildPermissionRegistry } from './build-registry';
import { SERVER_PERMISSIONS } from './server-capabilities';

const DECLARED_PERMISSIONS = [
  ...VEHICLE_PERMISSIONS,
  ...EXPENSE_PERMISSIONS,
  ...ODOMETER_PERMISSIONS,
  ...TRIP_PERMISSIONS,
  ...DRIVER_PERMISSIONS,
  ...REMINDER_PERMISSIONS,
  ...PHOTO_PERMISSIONS,
  ...FINANCING_PERMISSIONS,
  ...INSURANCE_PERMISSIONS,
  ...SHARE_PERMISSIONS,
  ...ROLE_PERMISSIONS,
  ...COMMUNITY_PERMISSIONS,
  ...ASSISTANT_PERMISSIONS,
  ...ACCOUNT_PERMISSIONS,
  ...SETTINGS_PERMISSIONS,
  ...PROVIDER_PERMISSIONS,
  ...SYNC_PERMISSIONS,
  ...PUSH_PERMISSIONS,
  ...CALENDAR_PERMISSIONS,
  ...SERVER_PERMISSIONS,
];

export type PermissionId = (typeof DECLARED_PERMISSIONS)[number]['id'];

export const PERMISSION_REGISTRY = buildPermissionRegistry(DECLARED_PERMISSIONS);
