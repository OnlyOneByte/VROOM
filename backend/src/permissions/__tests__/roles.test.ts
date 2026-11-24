import { describe, expect, test } from 'bun:test';
import { buildPermissionRegistry } from '../build-registry';
import { PERMISSION_REGISTRY } from '../registry';
import { ROLE_TEMPLATES, validateRoleTemplates } from '../roles';
import { definePermissions } from '../vocabulary';

const registry = buildPermissionRegistry(
  definePermissions({
    'vehicle.read': { label: 'See', scope: 'vehicle' },
    'vehicle.delete': { label: 'Delete', scope: 'vehicle', grantable: false },
    'vehicle.trip.write': { label: 'Log', scope: 'vehicle' },
    'server.audit.read': { label: 'Audit', scope: 'server' },
  })
);

describe('validateRoleTemplates', () => {
  test('throws on an unknown permission', () => {
    expect(() =>
      validateRoleTemplates(registry, [
        { key: 'viewer', name: 'Viewer', scope: 'vehicle', permissions: ['vehicle.trip.read'] },
      ])
    ).toThrow(/"viewer" lists "vehicle\.trip\.read", which is not a declared permission/);
  });

  test('throws on a permission no role can grant', () => {
    expect(() =>
      validateRoleTemplates(registry, [
        { key: 'co_owner', name: 'Co-owner', scope: 'vehicle', permissions: ['vehicle.delete'] },
      ])
    ).toThrow(/"co_owner" lists "vehicle\.delete", which only the owner holds/);
  });

  test('throws on a permission outside the role scope', () => {
    expect(() =>
      validateRoleTemplates(registry, [
        { key: 'editor', name: 'Editor', scope: 'vehicle', permissions: ['server.audit.read'] },
      ])
    ).toThrow(/"editor" is a vehicle role and can't hold the server permission/);
  });

  test('refuses vehicle permissions to any server role but Demo', () => {
    expect(() =>
      validateRoleTemplates(registry, [
        { key: 'support', name: 'Support', scope: 'server', permissions: ['vehicle.read'] },
      ])
    ).toThrow(/"support" is a server role and can't hold the vehicle permission "vehicle\.read"/);
  });

  test('lets Demo hold vehicle reads but not vehicle writes', () => {
    expect(
      validateRoleTemplates(registry, [
        { key: 'demo', name: 'Demo', scope: 'server', permissions: ['vehicle.read'] },
      ])
    ).toHaveLength(1);
    expect(() =>
      validateRoleTemplates(registry, [
        { key: 'demo', name: 'Demo', scope: 'server', permissions: ['vehicle.trip.write'] },
      ])
    ).toThrow(
      /"demo" is a server role and can't hold the vehicle permission "vehicle\.trip\.write"/
    );
  });

  test('throws on a duplicate key', () => {
    const viewer = {
      key: 'viewer',
      name: 'Viewer',
      scope: 'vehicle' as const,
      permissions: ['vehicle.read'],
    };
    expect(() => validateRoleTemplates(registry, [viewer, viewer])).toThrow(
      /"viewer" is declared more than once/
    );
  });
});

describe('built-in role templates', () => {
  const role = (key: string) => {
    const found = ROLE_TEMPLATES.find((t) => t.key === key);
    if (!found) throw new Error(`missing template ${key}`);
    return found;
  };

  test('ships the six templates, with no owner template', () => {
    expect(ROLE_TEMPLATES.map((t) => t.key)).toEqual([
      'admin',
      'member',
      'demo',
      'co_owner',
      'editor',
      'viewer',
    ]);
  });

  test('only Demo holds vehicle permissions among server roles', () => {
    for (const key of ['admin', 'member']) {
      const reach = role(key).permissions.filter((id) => !/^(server|account)\./.test(id));
      expect(reach, key).toEqual([]);
    }
  });

  test('Demo only reads, apart from signing out and refreshing its session', () => {
    const demoWrites = role('demo').permissions.filter((id) => !id.endsWith('.read'));
    expect(demoWrites).toEqual(['account.session.manage']);
  });

  test('Viewer is a subset of Editor, and Editor of Co-owner', () => {
    const editor = role('editor').permissions;
    const coOwner = role('co_owner').permissions;
    expect(role('viewer').permissions.filter((id) => !editor.includes(id))).toEqual([]);
    expect(editor.filter((id) => !coOwner.includes(id))).toEqual([]);
  });

  test('viewers do not see loan or insurance details', () => {
    expect(role('viewer').permissions).toContain('vehicle.expense.read');
    expect(role('viewer').permissions).not.toContain('vehicle.financing.read');
    expect(role('viewer').permissions).not.toContain('vehicle.insurance.read');
  });

  test('co-owners hold every grantable vehicle permission', () => {
    const grantable = PERMISSION_REGISTRY.list
      .filter((d) => d.scope === 'vehicle' && d.grantable)
      .map((d) => d.id);
    expect([...role('co_owner').permissions].sort()).toEqual(grantable.sort());
  });

  test('editors delete only their own entries', () => {
    const deletes = role('editor').permissions.filter((id) => /\.delete(_own)?$/.test(id));
    expect(deletes.every((id) => id.endsWith('.delete_own'))).toBe(true);
    expect(deletes).toHaveLength(5);
  });

  test('admins hold every server permission', () => {
    const server = PERMISSION_REGISTRY.list.filter((d) => d.scope === 'server').map((d) => d.id);
    expect(role('admin').permissions).toEqual(expect.arrayContaining(server));
  });
});
