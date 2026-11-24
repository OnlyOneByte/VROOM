import { describe, expect, test } from 'bun:test';
import { buildPermissionRegistry, PermissionRegistryError } from '../build-registry';
import { PERMISSION_REGISTRY } from '../registry';
import { definePermissions, parsePermissionId } from '../vocabulary';

describe('definePermissions', () => {
  test('fills the descriptor defaults', () => {
    expect(
      definePermissions({ 'vehicle.trip.read': { label: 'See trips', scope: 'vehicle' } })
    ).toEqual([
      {
        id: 'vehicle.trip.read',
        label: 'See trips',
        scope: 'vehicle',
        grantable: true,
        implies: [],
        sensitive: false,
      },
    ]);
  });
});

describe('parsePermissionId', () => {
  test.each([
    ['vehicle.read', { scope: 'vehicle', action: 'read' }],
    ['vehicle.expense.delete_own', { scope: 'vehicle', action: 'delete_own' }],
    ['account.backup.run', { scope: 'account', action: 'run' }],
  ])('accepts %s', (id, parsed) => {
    expect(parsePermissionId(id)).toEqual(parsed as ReturnType<typeof parsePermissionId>);
  });

  test.each([
    'vehicle',
    'Vehicle.read',
    'vehicle.expense.fly',
    'garage.expense.read',
    'vehicle.expense.photo.read',
    'vehicle..read',
    'vehicle.expense-item.read',
  ])('rejects %s', (id) => {
    expect(parsePermissionId(id)).toBeNull();
  });
});

describe('buildPermissionRegistry validation', () => {
  const read = definePermissions({ 'vehicle.trip.read': { label: 'See trips', scope: 'vehicle' } });

  test('throws on a duplicate id across declarations', () => {
    expect(() => buildPermissionRegistry([...read, ...read])).toThrow(
      new PermissionRegistryError('Permission "vehicle.trip.read" is declared more than once')
    );
  });

  test('throws on a malformed id', () => {
    const bad = definePermissions({ 'vehicle.trip.fly': { label: 'Fly', scope: 'vehicle' } });
    expect(() => buildPermissionRegistry(bad)).toThrow(/"vehicle\.trip\.fly" is malformed/);
  });

  test('throws when the declared scope does not match the id', () => {
    const bad = definePermissions({ 'vehicle.trip.write': { label: 'Log', scope: 'account' } });
    expect(() => buildPermissionRegistry(bad)).toThrow(
      /"vehicle\.trip\.write" declares scope "account" but its id starts with "vehicle"/
    );
  });

  test('throws when implies names an undeclared permission', () => {
    const bad = definePermissions({
      'vehicle.trip.write': {
        label: 'Log',
        scope: 'vehicle',
        implies: ['vehicle.trip.read'],
      },
    });
    expect(() => buildPermissionRegistry(bad)).toThrow(
      /"vehicle\.trip\.write" implies "vehicle\.trip\.read", which is not a declared permission/
    );
  });

  test('accepts a well-formed set and looks ids up', () => {
    const registry = buildPermissionRegistry([
      ...read,
      ...definePermissions({
        'vehicle.trip.write': { label: 'Log', scope: 'vehicle', implies: ['vehicle.trip.read'] },
      }),
    ]);
    expect(registry.list.map((d) => d.id)).toEqual(['vehicle.trip.read', 'vehicle.trip.write']);
    expect(registry.has('vehicle.trip.write')).toBe(true);
    expect(registry.has('vehicle.trip.delete')).toBe(false);
  });
});

describe('the app registry', () => {
  const ids = (keep: (d: (typeof PERMISSION_REGISTRY.list)[number]) => boolean) =>
    PERMISSION_REGISTRY.list
      .filter(keep)
      .map((d) => d.id)
      .sort();

  test('only the owner-only permissions are not grantable', () => {
    expect(ids((d) => !d.grantable)).toEqual(['vehicle.delete', 'vehicle.transfer']);
  });

  test('exactly the loan and insurance reads are sensitive', () => {
    expect(ids((d) => d.sensitive)).toEqual(['vehicle.financing.read', 'vehicle.insurance.read']);
  });

  test('every write implies the read on the same resource when one exists', () => {
    const missing = PERMISSION_REGISTRY.list
      .filter((d) => d.id.endsWith('.write'))
      .map((d) => ({ write: d.id, read: d.id.replace(/\.write$/, '.read'), implies: d.implies }))
      .filter(({ read, implies }) => PERMISSION_REGISTRY.has(read) && !implies.includes(read));
    expect(missing).toEqual([]);
  });

  test('declares every scope', () => {
    expect([...new Set(PERMISSION_REGISTRY.list.map((d) => d.scope))].sort()).toEqual([
      'account',
      'server',
      'vehicle',
    ]);
  });
});
