import type { PermissionId } from './registry';

export type RoleScopeRule = { byScope: { server: PermissionId; vehicle: PermissionId } };
export type EntityRule = { byEntity: Record<string, readonly PermissionId[]> };
export type RouteRule = PermissionId | { public: string } | RoleScopeRule | EntityRule;

export function isPublicRule(rule: RouteRule): rule is { public: string } {
  return typeof rule === 'object' && 'public' in rule;
}

export function rulePermissions(rule: RouteRule): PermissionId[] {
  if (typeof rule === 'string') return [rule];
  if ('byScope' in rule) return Object.values(rule.byScope);
  if ('byEntity' in rule) return Object.values(rule.byEntity).flat();
  return [];
}

function photoRule(action: 'read' | 'write' | 'delete'): EntityRule {
  const photo: PermissionId = `vehicle.photo.${action}`;
  const access = action === 'read' ? 'read' : 'write';
  const insurance: PermissionId = `vehicle.insurance.${access}`;
  return {
    byEntity: {
      vehicle: [photo],
      expense: [photo, `vehicle.expense.${access}`],
      odometer_entry: [photo, `vehicle.odometer.${access}`],
      insurance_policy: [photo, insurance],
      insurance_claim: [photo, insurance],
    },
  };
}

const ROLE_SCOPED: RoleScopeRule = {
  byScope: { server: 'server.roles.manage', vehicle: 'vehicle.share.manage' },
};

export const ROUTE_PERMISSIONS: Record<string, RouteRule> = {
  'GET /health': { public: 'Liveness probe for containers and load balancers' },
  'GET /api': { public: 'API version banner' },

  'GET /api/v1/auth/providers': { public: 'The sign-in page lists the enabled sign-in methods' },
  'GET /api/v1/auth/signup': {
    public: 'The sign-in page says who can join: the sign-up mode, never the domain list',
  },
  'GET /api/v1/auth/demo': { public: 'The sign-in page asks whether the demo garage is on' },
  'POST /api/v1/auth/demo': { public: 'Starts a demo session for a signed-out visitor' },
  'GET /api/v1/auth/login/:authProvider': { public: 'Starts sign-in for a signed-out visitor' },
  'GET /api/v1/auth/callback/:authProvider': { public: 'Sign-in callback from the provider' },
  'GET /api/v1/auth/link/:authProvider': 'account.signin.manage',
  'GET /api/v1/auth/callback/link/:authProvider': 'account.signin.manage',
  'GET /api/v1/auth/me': 'account.profile.read',
  'PATCH /api/v1/auth/me': 'account.profile.write',
  'GET /api/v1/auth/capabilities': 'account.profile.read',
  'POST /api/v1/auth/logout': 'account.session.manage',
  'POST /api/v1/auth/refresh': 'account.session.manage',
  'GET /api/v1/auth/accounts': 'account.signin.manage',
  'DELETE /api/v1/auth/accounts/:id': 'account.signin.manage',
  'GET /api/v1/auth/providers/connect/google': 'account.provider.manage',
  'GET /api/v1/auth/callback/provider/google': 'account.provider.manage',

  'GET /api/v1/vehicles': 'vehicle.read',
  'POST /api/v1/vehicles': 'account.vehicle.write',
  'GET /api/v1/vehicles/:id': 'vehicle.read',
  'PUT /api/v1/vehicles/:id': 'vehicle.write',
  'DELETE /api/v1/vehicles/:id': 'vehicle.delete',
  'GET /api/v1/vehicles/:id/stats': 'vehicle.expense.read',
  'GET /api/v1/vehicles/:vehicleId/photos': 'vehicle.photo.read',
  'POST /api/v1/vehicles/:vehicleId/photos': 'vehicle.photo.write',
  'GET /api/v1/vehicles/:vehicleId/photos/:photoId/thumbnail': 'vehicle.photo.read',
  'PUT /api/v1/vehicles/:vehicleId/photos/:photoId/cover': 'vehicle.photo.write',
  'DELETE /api/v1/vehicles/:vehicleId/photos/:photoId': 'vehicle.photo.delete',
  'GET /api/v1/vehicles/:vehicleId/drivers': 'vehicle.driver.record',
  'GET /api/v1/vehicles/:vehicleId/drivers/stats': 'vehicle.driver_stats.read_own',
  'POST /api/v1/vehicles/:vehicleId/drivers': 'vehicle.driver.manage',
  'PATCH /api/v1/vehicles/:vehicleId/drivers/:driverId': 'vehicle.driver.manage',
  'GET /api/v1/vehicles/:vehicleId/drivers/backfill': 'vehicle.driver.manage',
  'POST /api/v1/vehicles/:vehicleId/drivers/backfill/preview': 'vehicle.driver.manage',
  'POST /api/v1/vehicles/:vehicleId/drivers/backfill': 'vehicle.driver.manage',
  'POST /api/v1/vehicles/:vehicleId/drivers/backfill/:batchId/undo': 'vehicle.driver.manage',
  'PUT /api/v1/vehicles/:vehicleId/car-share': 'vehicle.driver.manage',

  'GET /api/v1/financing/vehicles/:vehicleId/financing': 'vehicle.financing.read',
  'POST /api/v1/financing/vehicles/:vehicleId/financing': 'vehicle.financing.write',
  'PATCH /api/v1/financing/:financingId/payment-amount': 'vehicle.financing.write',
  'PUT /api/v1/financing/:financingId/payoff': 'vehicle.financing.write',
  'DELETE /api/v1/financing/:financingId': 'vehicle.financing.write',

  'GET /api/v1/expenses': 'vehicle.expense.read',
  'POST /api/v1/expenses': 'vehicle.expense.write',
  'GET /api/v1/expenses/summary': 'vehicle.expense.read',
  'GET /api/v1/expenses/monthly-totals': 'vehicle.expense.read',
  'GET /api/v1/expenses/export': 'vehicle.expense.read',
  'POST /api/v1/expenses/import': 'account.import.run',
  'GET /api/v1/expenses/import/formats': 'account.import.run',
  'POST /api/v1/expenses/import/detect': 'account.import.run',
  'GET /api/v1/expenses/:id': 'vehicle.expense.read',
  'PUT /api/v1/expenses/:id': 'vehicle.expense.write',
  'DELETE /api/v1/expenses/:id': 'vehicle.expense.delete',
  'POST /api/v1/expenses/split': 'vehicle.expense.write',
  'GET /api/v1/expenses/split/:id': 'vehicle.expense.read',
  'PUT /api/v1/expenses/split/:id': 'vehicle.expense.write',
  'DELETE /api/v1/expenses/split/:id': 'vehicle.expense.delete',

  'GET /api/v1/insurance': 'vehicle.insurance.read',
  'POST /api/v1/insurance': 'vehicle.insurance.write',
  'GET /api/v1/insurance/vehicles/:vehicleId/policies': 'vehicle.read',
  'GET /api/v1/insurance/:id': 'vehicle.insurance.read',
  'PUT /api/v1/insurance/:id': 'vehicle.insurance.write',
  'DELETE /api/v1/insurance/:id': 'vehicle.insurance.write',
  'POST /api/v1/insurance/:id/terms': 'vehicle.insurance.write',
  'PUT /api/v1/insurance/:id/terms/:termId': 'vehicle.insurance.write',
  'DELETE /api/v1/insurance/:id/terms/:termId': 'vehicle.insurance.write',
  'GET /api/v1/insurance/:id/claims': 'vehicle.read',
  'POST /api/v1/insurance/:id/claims': 'vehicle.insurance.write',
  'PUT /api/v1/insurance/:id/claims/:claimId': 'vehicle.insurance.write',
  'DELETE /api/v1/insurance/:id/claims/:claimId': 'vehicle.insurance.write',

  'GET /api/v1/odometer/:vehicleId': 'vehicle.odometer.read',
  'POST /api/v1/odometer/:vehicleId': 'vehicle.odometer.write',
  'GET /api/v1/odometer/:vehicleId/history': 'vehicle.odometer.read',
  'GET /api/v1/odometer/entry/:id': 'vehicle.odometer.read',
  'PUT /api/v1/odometer/:id': 'vehicle.odometer.write',
  'DELETE /api/v1/odometer/:id': 'vehicle.odometer.delete',

  'GET /api/v1/photos/receipt-drafts': 'account.assistant.use',
  'GET /api/v1/photos': 'vehicle.photo.read',
  'GET /api/v1/photos/orphans': 'vehicle.photo.read',
  'DELETE /api/v1/photos/orphans': 'vehicle.photo.delete',
  'GET /api/v1/photos/:entityType/:entityId': photoRule('read'),
  'POST /api/v1/photos/:entityType/:entityId': photoRule('write'),
  'GET /api/v1/photos/:entityType/:entityId/:photoId/thumbnail': photoRule('read'),
  'DELETE /api/v1/photos/:entityType/:entityId/:photoId': photoRule('delete'),

  'GET /api/v1/providers': 'account.provider.manage',
  'POST /api/v1/providers': 'account.provider.manage',
  'GET /api/v1/providers/catalog': 'account.provider.manage',
  'GET /api/v1/providers/pending/:nonce': 'account.provider.manage',
  'PUT /api/v1/providers/:id': 'account.provider.manage',
  'DELETE /api/v1/providers/:id': 'account.provider.manage',
  'POST /api/v1/providers/:id/test': 'account.provider.manage',
  'POST /api/v1/providers/:id/backfill': 'account.provider.manage',
  'GET /api/v1/providers/:id/sync-status': 'account.provider.manage',

  'POST /api/v1/receipts/parse': 'account.assistant.use',
  'POST /api/v1/assistant/chat': 'account.assistant.use',

  'GET /api/v1/settings': 'account.settings.read',
  'PUT /api/v1/settings': 'account.settings.write',

  'POST /api/v1/sync': 'account.backup.run',
  'POST /api/v1/sync/sheets/:providerId/resume': 'account.backup.run',
  'GET /api/v1/sync/status': 'account.backup.run',
  'GET /api/v1/sync/backups/providers': 'account.backup.run',
  'GET /api/v1/sync/backups/download': 'account.export.run',
  'POST /api/v1/sync/restore/from-provider': 'account.backup.restore',
  'POST /api/v1/sync/restore/from-backup': 'account.backup.restore',
  'GET /api/v1/sync/restore/providers': 'account.backup.restore',

  'GET /api/v1/analytics/query': 'vehicle.expense.read',
  'GET /api/v1/analytics/query/items': 'vehicle.expense.read',
  'GET /api/v1/analytics/insights': 'vehicle.expense.read',
  'GET /api/v1/analytics/summary': 'vehicle.expense.read',
  'GET /api/v1/analytics/quick-stats': 'vehicle.expense.read',
  'GET /api/v1/analytics/fuel-stats': 'vehicle.expense.read',
  'GET /api/v1/analytics/cross-vehicle': 'vehicle.expense.read',
  'GET /api/v1/analytics/financing': 'vehicle.financing.read',
  'GET /api/v1/analytics/insurance': 'vehicle.insurance.read',
  'GET /api/v1/analytics/fuel-advanced': 'vehicle.expense.read',
  'GET /api/v1/analytics/vehicle-health': 'vehicle.read',
  'GET /api/v1/analytics/vehicle-tco': 'vehicle.expense.read',
  'GET /api/v1/analytics/vehicle-expenses': 'vehicle.expense.read',
  'GET /api/v1/analytics/year-end': 'vehicle.expense.read',
  'GET /api/v1/analytics/fuel-efficiency': 'vehicle.expense.read',

  'GET /api/v1/community/compare': 'vehicle.community.read',

  'GET /api/v1/reminders': 'vehicle.reminder.read',
  'POST /api/v1/reminders': 'vehicle.reminder.write',
  'POST /api/v1/reminders/trigger': 'vehicle.reminder.write',
  'GET /api/v1/reminders/recurring-cost': 'vehicle.reminder.read',
  'GET /api/v1/reminders/notifications': 'vehicle.reminder.read',
  'PUT /api/v1/reminders/notifications/:id/read': 'vehicle.reminder.write',
  'POST /api/v1/reminders/:id/mark-serviced': 'vehicle.reminder.write',
  'GET /api/v1/reminders/:id/expenses': 'vehicle.reminder.read',
  'PUT /api/v1/reminders/:id': 'vehicle.reminder.write',
  'DELETE /api/v1/reminders/:id': 'vehicle.reminder.delete',

  'GET /api/v1/trips': 'vehicle.trip.read',
  'POST /api/v1/trips': 'vehicle.trip.write',
  'GET /api/v1/trips/summary': 'vehicle.trip.read',
  'PUT /api/v1/trips/:id': 'vehicle.trip.write',
  'DELETE /api/v1/trips/:id': 'vehicle.trip.delete',

  'POST /api/v1/shares': 'vehicle.share.manage',
  'GET /api/v1/shares/granted': 'vehicle.share.read',
  'PUT /api/v1/shares/:id': 'vehicle.share.manage',
  'DELETE /api/v1/shares/:id': 'vehicle.share.manage',
  'GET /api/v1/shares/received': 'account.share.read',
  'POST /api/v1/shares/:id/accept': 'account.share.manage',
  'POST /api/v1/shares/:id/decline': 'account.share.manage',

  'GET /api/v1/vehicles/:id/people': 'vehicle.share.read',
  'GET /api/v1/roles': 'account.roles.manage',
  'POST /api/v1/roles': 'account.roles.manage',
  'PATCH /api/v1/roles/:id': 'account.roles.manage',
  'DELETE /api/v1/roles/:id': 'account.roles.manage',
  'GET /api/v1/roles/:id/permissions': 'account.roles.manage',
  'PUT /api/v1/roles/:id/permissions': 'account.roles.manage',
  'POST /api/v1/role-assignments': ROLE_SCOPED,
  'DELETE /api/v1/role-assignments': ROLE_SCOPED,
  'GET /api/v1/overrides': ROLE_SCOPED,
  'PUT /api/v1/overrides': ROLE_SCOPED,
  'DELETE /api/v1/overrides': ROLE_SCOPED,

  'GET /api/v1/admin/signup': 'server.signup.manage',
  'PUT /api/v1/admin/signup': 'server.signup.manage',
  'GET /api/v1/admin/invites': 'server.signup.manage',
  'POST /api/v1/admin/invites': 'server.signup.manage',
  'DELETE /api/v1/admin/invites/:id': 'server.signup.manage',
  'GET /api/v1/admin/pending-accounts': 'server.signup.manage',
  'POST /api/v1/admin/pending-accounts/:id/approve': 'server.signup.manage',
  'DELETE /api/v1/admin/pending-accounts/:id': 'server.signup.manage',

  'GET /api/v1/push/vapid-public-key': 'account.push.read',
  'POST /api/v1/push/subscribe': 'account.push.write',
  'DELETE /api/v1/push/subscribe': 'account.push.write',

  'GET /api/v1/calendar/feed/:file': {
    public: 'Calendar apps fetch the feed with the secret token in the link, without a session',
  },
  'GET /api/v1/calendar/feed': 'account.calendar.read',
  'POST /api/v1/calendar/feed': 'account.calendar.manage',
  'PUT /api/v1/calendar/feed': 'account.calendar.manage',
  'DELETE /api/v1/calendar/feed': 'account.calendar.manage',
};
