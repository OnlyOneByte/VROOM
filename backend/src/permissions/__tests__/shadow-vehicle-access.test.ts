import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../test-helpers/http-client';
import { createInvitee } from '../../test-helpers/invitee';
import { seedVehicle } from '../../test-helpers/seed';
import {
  allowsMode,
  requireVehicleAccess,
  resolveVehicleAccess,
  type VehicleAccessMode,
} from '../../utils/vehicle-access';
import { resolverFor } from '../grants';
import { PERMISSION_REGISTRY } from '../registry';

const TODAY_MODE: Record<string, VehicleAccessMode> = {
  'vehicle.read': 'read',
  'vehicle.write': 'owner',
  'vehicle.delete': 'owner',
  'vehicle.transfer': 'owner',
  'vehicle.expense.read': 'read',
  'vehicle.expense.write': 'write',
  'vehicle.expense.delete': 'write',
  'vehicle.expense.delete_own': 'write',
  'vehicle.odometer.read': 'read',
  'vehicle.odometer.write': 'write',
  'vehicle.odometer.delete': 'write',
  'vehicle.odometer.delete_own': 'write',
  'vehicle.trip.read': 'owner',
  'vehicle.trip.write': 'owner',
  'vehicle.trip.delete': 'owner',
  'vehicle.trip.delete_own': 'owner',
  'vehicle.reminder.read': 'read',
  'vehicle.reminder.write': 'write',
  'vehicle.reminder.delete': 'write',
  'vehicle.reminder.delete_own': 'write',
  'vehicle.photo.read': 'write',
  'vehicle.photo.write': 'write',
  'vehicle.photo.delete': 'write',
  'vehicle.photo.delete_own': 'write',
  'vehicle.financing.read': 'owner',
  'vehicle.financing.write': 'owner',
  'vehicle.insurance.read': 'read',
  'vehicle.insurance.write': 'owner',
  'vehicle.share.read': 'owner',
  'vehicle.share.manage': 'owner',
  'vehicle.community.read': 'read',
  'vehicle.community.manage': 'owner',
  'vehicle.assistant.use': 'read',
  'vehicle.driver.record': 'owner',
  'vehicle.driver.manage': 'owner',
  'vehicle.driver_stats.read': 'owner',
  'vehicle.driver_stats.read_own': 'owner',
};

const INTENDED_DIFFERENCES = [
  ...['expense', 'odometer', 'reminder', 'photo'].map((resource) => ({
    role: 'editor',
    permission: `vehicle.${resource}.delete`,
    today: true,
    why: 'Editors delete only the entries they added',
  })),
  ...['read', 'write', 'delete_own'].map((action) => ({
    role: 'editor',
    permission: `vehicle.trip.${action}`,
    today: false,
    why: 'Editors log trips',
  })),
  { role: 'viewer', permission: 'vehicle.trip.read', today: false, why: 'Viewers see trips' },
  { role: 'viewer', permission: 'vehicle.photo.read', today: false, why: 'Viewers see photos' },
  {
    role: 'editor',
    permission: 'vehicle.driver.record',
    today: false,
    why: 'Editors record who drove or paid once car sharing is on',
  },
  ...['editor', 'viewer'].map((role) => ({
    role,
    permission: 'vehicle.driver_stats.read_own',
    today: false,
    why: 'Every driver sees their own figures once car sharing is on',
  })),
  ...['editor', 'viewer'].flatMap((role) => [
    { role, permission: 'vehicle.share.read', today: false, why: 'Members see who has access' },
    {
      role,
      permission: 'vehicle.insurance.read',
      today: true,
      why: 'Insurance stays hidden unless the owner allows it',
    },
    {
      role,
      permission: 'vehicle.assistant.use',
      today: true,
      why: "Asking the assistant about someone's car needs its own grant",
    },
  ]),
];

const VEHICLE_PERMISSIONS = PERMISSION_REGISTRY.list
  .filter((d) => d.scope === 'vehicle')
  .map((d) => d.id);

let ctx: TestApp;
let vehicleId: string;
let people: Record<string, string>;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
  const editor = await createInvitee(ctx, 'shadow-editor');
  const viewer = await createInvitee(ctx, 'shadow-viewer');
  const stranger = await createInvitee(ctx, 'shadow-stranger');
  await editor.acceptShare(vehicleId, 'editor');
  await viewer.acceptShare(vehicleId, 'viewer');
  people = { owner: ctx.user.id, editor: editor.id, viewer: viewer.id, stranger: stranger.id };
}, SETUP_TIMEOUT_MS);

afterEach(() => ctx.close());

describe('shadow mode: the resolver agrees with utils/vehicle-access.ts for the built-in roles', () => {
  test('every vehicle permission has a mode today', () => {
    expect(Object.keys(TODAY_MODE).sort()).toEqual([...VEHICLE_PERMISSIONS].sort());
  });

  test('they disagree only where the role templates intend to', async () => {
    const differences: { role: string; permission: string; today: boolean }[] = [];
    for (const [role, userId] of Object.entries(people)) {
      const access = await resolveVehicleAccess(vehicleId, userId);
      const resolver = await resolverFor(userId, [{ kind: 'vehicle', vehicleId }]);
      for (const permission of VEHICLE_PERMISSIONS) {
        const today = allowsMode(access, TODAY_MODE[permission] ?? 'owner');
        if (resolver.can(permission, { kind: 'vehicle', vehicleId }).allow !== today) {
          differences.push({ role, permission, today });
        }
      }
    }
    const key = (d: { role: string; permission: string }) => `${d.role} ${d.permission}`;
    expect(differences.map(key).sort()).toEqual(INTENDED_DIFFERENCES.map(key).sort());
    for (const difference of differences) {
      expect(INTENDED_DIFFERENCES.find((d) => key(d) === key(difference))?.today).toBe(
        difference.today
      );
    }
  });

  test('a stranger is not found by either', async () => {
    const stranger = await resolverFor(people.stranger ?? '', [{ kind: 'vehicle', vehicleId }]);
    const decision = stranger.can('vehicle.read', {
      kind: 'vehicle',
      vehicleId,
    });
    expect(decision).toEqual({ allow: false, reason: 'not_found' });
    await expect(requireVehicleAccess(vehicleId, people.stranger ?? '', 'read')).rejects.toThrow(
      'Vehicle not found'
    );
  });
});
