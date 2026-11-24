import { type PermissionRegistry, PermissionRegistryError } from './build-registry';
import { PERMISSION_REGISTRY, type PermissionId } from './registry';
import { type PermissionDescriptor, type PermissionScope, parsePermissionId } from './vocabulary';

export type RoleScope = 'server' | 'household' | 'vehicle';

export interface RoleTemplate<Id extends string = string> {
  key: string;
  name: string;
  scope: RoleScope;
  permissions: readonly Id[];
}

export const ROLE_REACH: Record<RoleScope, readonly PermissionScope[]> = {
  server: ['server', 'account', 'vehicle'],
  household: ['household', 'vehicle'],
  vehicle: ['vehicle'],
};

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
    if (!ROLE_REACH[template.scope].includes(descriptor.scope)) {
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
];

const VIEWER_HIDDEN: readonly PermissionId[] = ['vehicle.financing.read', 'vehicle.insurance.read'];

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
      key: 'demo',
      name: 'Demo',
      scope: 'server',
      permissions: select((d) => (d.scope === 'account' || d.scope === 'vehicle') && isRead(d)),
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
      permissions: select(
        (d) => d.scope === 'vehicle' && isRead(d) && !VIEWER_HIDDEN.includes(d.id)
      ),
    },
    {
      key: 'household_admin',
      name: 'Household admin',
      scope: 'household',
      permissions: select((d) => d.scope === 'household'),
    },
    {
      key: 'household_member',
      name: 'Household member',
      scope: 'household',
      permissions: ['household.read', ...EDITOR_PERMISSIONS],
    },
  ];
}

export const ROLE_TEMPLATES = validateRoleTemplates(
  PERMISSION_REGISTRY,
  buildRoleTemplates(PERMISSION_REGISTRY)
);
