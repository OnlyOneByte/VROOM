import { type PermissionRegistry, PermissionRegistryError } from './build-registry';
import { PERMISSION_REGISTRY, type PermissionId } from './registry';
import { type PermissionDescriptor, type PermissionScope, parsePermissionId } from './vocabulary';

export type RoleScope = 'server' | 'vehicle';

export interface RoleTemplate<Id extends string = string> {
  key: string;
  name: string;
  scope: RoleScope;
  permissions: readonly Id[];
}

export const DEMO_ROLE_KEY = 'demo';

export const ROLE_REACH: Record<RoleScope, readonly PermissionScope[]> = {
  server: ['server', 'account'],
  vehicle: ['vehicle'],
};

function isDemoVehicleRead(template: RoleTemplate, descriptor: PermissionDescriptor): boolean {
  return (
    template.scope === 'server' &&
    template.key === DEMO_ROLE_KEY &&
    descriptor.scope === 'vehicle' &&
    parsePermissionId(descriptor.id)?.action === 'read'
  );
}

function withinReach(template: RoleTemplate, descriptor: PermissionDescriptor): boolean {
  return (
    ROLE_REACH[template.scope].includes(descriptor.scope) || isDemoVehicleRead(template, descriptor)
  );
}

function validateTemplate(registry: PermissionRegistry, template: RoleTemplate): void {
  for (const id of template.permissions) {
    const descriptor = registry.get(id);
    if (!descriptor) {
      throw new PermissionRegistryError(
        `Role "${template.key}" lists "${id}", which is not a declared permission`
      );
    }
    if (!descriptor.grantable) {
      throw new PermissionRegistryError(
        `Role "${template.key}" lists "${id}", which only the owner holds and no role can grant`
      );
    }
    if (!withinReach(template, descriptor)) {
      throw new PermissionRegistryError(
        `Role "${template.key}" is a ${template.scope} role and can't hold the ${descriptor.scope} permission "${id}"`
      );
    }
  }
}

export function validateRoleTemplates<Id extends string>(
  registry: PermissionRegistry,
  templates: readonly RoleTemplate<Id>[]
): readonly RoleTemplate<Id>[] {
  const keys = new Set<string>();
  for (const template of templates) {
    if (keys.has(template.key)) {
      throw new PermissionRegistryError(`Role "${template.key}" is declared more than once`);
    }
    keys.add(template.key);
    validateTemplate(registry, template);
  }
  return templates;
}

const EDITOR_PERMISSIONS: readonly PermissionId[] = [
  'vehicle.read',
  'vehicle.expense.read',
  'vehicle.expense.write',
  'vehicle.expense.delete_own',
  'vehicle.odometer.read',
  'vehicle.odometer.write',
  'vehicle.odometer.delete_own',
  'vehicle.trip.read',
  'vehicle.trip.write',
  'vehicle.trip.delete_own',
  'vehicle.reminder.read',
  'vehicle.reminder.write',
  'vehicle.reminder.delete_own',
  'vehicle.photo.read',
  'vehicle.photo.write',
  'vehicle.photo.delete_own',
  'vehicle.share.read',
  'vehicle.community.read',
  'vehicle.driver.record',
  'vehicle.driver_stats.read_own',
];

const VIEWER_HIDDEN: readonly PermissionId[] = [
  'vehicle.financing.read',
  'vehicle.insurance.read',
  'vehicle.driver_stats.read',
];

function buildRoleTemplates(
  registry: PermissionRegistry<PermissionId>
): RoleTemplate<PermissionId>[] {
  const select = (keep: (descriptor: PermissionDescriptor<PermissionId>) => boolean) =>
    registry.list.filter(keep).map((descriptor) => descriptor.id);
  const isRead = (descriptor: PermissionDescriptor) =>
    parsePermissionId(descriptor.id)?.action === 'read';

  const member = select((d) => d.scope === 'account');
  return [
    {
      key: 'admin',
      name: 'Admin',
      scope: 'server',
      permissions: [...select((d) => d.scope === 'server'), ...member],
    },
    { key: 'member', name: 'Member', scope: 'server', permissions: member },
    {
      key: DEMO_ROLE_KEY,
      name: 'Demo',
      scope: 'server',
      permissions: [
        ...select((d) => (d.scope === 'account' || d.scope === 'vehicle') && isRead(d)),
        'account.session.manage',
      ],
    },
    {
      key: 'co_owner',
      name: 'Co-owner',
      scope: 'vehicle',
      permissions: select((d) => d.scope === 'vehicle' && d.grantable),
    },
    { key: 'editor', name: 'Editor', scope: 'vehicle', permissions: EDITOR_PERMISSIONS },
    {
      key: 'viewer',
      name: 'Viewer',
      scope: 'vehicle',
      permissions: [
        ...select((d) => d.scope === 'vehicle' && isRead(d) && !VIEWER_HIDDEN.includes(d.id)),
        'vehicle.driver_stats.read_own',
      ],
    },
  ];
}

export const ROLE_TEMPLATES = validateRoleTemplates(
  PERMISSION_REGISTRY,
  buildRoleTemplates(PERMISSION_REGISTRY)
);
