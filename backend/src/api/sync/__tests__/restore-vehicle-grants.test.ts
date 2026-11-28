import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { appContext } from '../../../app-context';
import {
  assignServerRole,
  builtInRoleId,
  grantShareRole,
  resolverFor,
} from '../../../permissions/grants';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import type { RestoreResponse } from '../restore';

let ctx: TestApp;
let vehicleId: string;
const CUSTOM_ROLE = 'custom-mechanic';

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
  await ctx.sql.run(
    "INSERT INTO roles (id, scope, name, built_in, owner_user_id) VALUES (?, 'vehicle', 'Mechanic', FALSE, ?)",
    [CUSTOM_ROLE, ctx.user.id]
  );
  await ctx.sql.run(
    "INSERT INTO role_permissions (role_id, permission) VALUES (?, 'vehicle.odometer.write')",
    [CUSTOM_ROLE]
  );
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function addMember(id: string): Promise<void> {
  await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    `${id}@test.com`,
    id,
  ]);
  await assignServerRole(appContext().asyncDb, id, 'member');
  await ctx.sql.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'viewer', 'accepted', 0, 0)`,
    [`share-${id}`, vehicleId, ctx.user.id, id]
  );
  await grantShareRole(appContext().asyncDb, {
    vehicleId,
    sharedWithId: id,
    level: 'viewer',
    grantedBy: ctx.user.id,
  });
}

async function override(userId: string, permission: string, setBy = ctx.user.id, effect = 'allow') {
  await ctx.sql.run(
    "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect, set_by) VALUES (?, ?, 'vehicle', ?, ?, ?, ?)",
    [`po-${userId}-${permission}`, userId, vehicleId, permission, effect, setBy]
  );
}

async function assign(userId: string, roleId: string): Promise<void> {
  await ctx.sql.run(
    'INSERT INTO role_assignments (id, user_id, role_id, scope_id, granted_by) VALUES (?, ?, ?, ?, ?)',
    [`ra-${userId}-${roleId}`, userId, roleId, vehicleId, ctx.user.id]
  );
}

async function grantsOf(userId: string) {
  const overrides = await ctx.sql.all(
    'SELECT permission, effect FROM permission_overrides WHERE user_id = ? AND scope_id = ? ORDER BY permission',
    [userId, vehicleId]
  );
  const roles = (
    (await ctx.sql.all(
      'SELECT role_id FROM role_assignments WHERE user_id = ? AND scope_id = ? ORDER BY role_id',
      [userId, vehicleId]
    )) as { role_id: string }[]
  ).map((row) => row.role_id);
  return { overrides, roles };
}

async function exportZip(): Promise<Buffer> {
  const { backupService } = await import('../backup');
  return backupService.exportAsZip(ctx.user.id);
}

async function restore(zip: Buffer): Promise<RestoreResponse> {
  const { restoreService } = await import('../restore');
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
  return result;
}

function csv(rows: Record<string, string>[]): Buffer {
  const columns = Object.keys(rows[0] ?? {});
  const line = (values: string[]) => values.map((v) => `"${v}"`).join(',');
  return Buffer.from(
    [line(columns), ...rows.map((row) => line(columns.map((c) => row[c] ?? '')))].join('\n')
  );
}

async function can(userId: string, permission: string): Promise<boolean> {
  const car = { kind: 'vehicle' as const, vehicleId };
  return (await resolverFor(userId, [car])).can(permission, car).allow;
}

describe('a full restore keeps the per-person grants of current members, from live state', () => {
  test('overrides and custom or co-owner roles survive for people who still hold the share', async () => {
    await addMember('member-1');
    await override('member-1', 'vehicle.expense.write');
    await override('member-1', 'vehicle.photo.read', ctx.user.id, 'deny');
    await assign('member-1', CUSTOM_ROLE);
    await assign('member-1', builtInRoleId('co_owner'));
    const before = await grantsOf('member-1');

    const result = await restore(await exportZip());

    expect(await grantsOf('member-1')).toEqual(before);
    expect(result.grants).toEqual({ reapplied: 4, dropped: [] });
    expect(await can('member-1', 'vehicle.expense.write')).toBe(true);
    expect(await can('member-1', 'vehicle.photo.read')).toBe(false);
  });

  test('grants of someone whose share is not in the restored data are dropped and reported', async () => {
    const zip = await exportZip();
    await addMember('late-1');
    await override('late-1', 'vehicle.expense.write');
    await assign('late-1', CUSTOM_ROLE);

    const result = await restore(zip);

    expect(await grantsOf('late-1')).toEqual({ overrides: [], roles: [] });
    expect(result.grants).toEqual({
      reapplied: 0,
      dropped: [
        { kind: 'role', vehicleId, reason: 'person_not_active' },
        { kind: 'override', vehicleId, reason: 'person_not_active' },
      ],
    });
    expect(await can('late-1', 'vehicle.expense.write')).toBe(false);
  });

  test('someone who left and someone whose account is not active are reported the same way', async () => {
    await addMember('left-2');
    await addMember('off-2');
    await override('left-2', 'vehicle.trip.write');
    await override('off-2', 'vehicle.trip.write');
    const zip = new AdmZip(await exportZip());
    const shares = zip.getEntry('vehicle_shares.csv')?.getData().toString('utf-8') ?? '';
    zip.updateFile(
      'vehicle_shares.csv',
      Buffer.from(
        shares
          .split('\n')
          .filter((line) => !line.includes('left-2'))
          .join('\n'),
        'utf-8'
      )
    );
    await ctx.sql.run('UPDATE users SET disabled_at = 1 WHERE id = ?', ['off-2']);

    const result = await restore(zip.toBuffer());

    expect(result.grants?.dropped).toEqual([
      { kind: 'override', vehicleId, reason: 'person_not_active' },
      { kind: 'override', vehicleId, reason: 'person_not_active' },
    ]);
    expect((await grantsOf('left-2')).overrides).toEqual([]);
    expect((await grantsOf('off-2')).overrides).toEqual([]);
    expect(JSON.stringify(result.grants)).not.toMatch(/left-2|off-2/);
  });

  test('a crafted backup cannot add or widen any grant', async () => {
    await addMember('member-2');
    await override('member-2', 'vehicle.odometer.write');
    const zip = new AdmZip(await exportZip());
    zip.addFile(
      'permission_overrides.csv',
      csv([
        {
          id: 'forged-o1',
          userId: 'member-2',
          scope: 'vehicle',
          scopeId: vehicleId,
          permission: 'vehicle.share.manage',
          effect: 'allow',
          setBy: ctx.user.id,
        },
      ])
    );
    zip.addFile(
      'role_assignments.csv',
      csv([
        {
          id: 'forged-a1',
          userId: 'member-2',
          roleId: builtInRoleId('co_owner'),
          scopeId: vehicleId,
          grantedBy: ctx.user.id,
        },
      ])
    );

    const result = await restore(zip.toBuffer());

    expect(await grantsOf('member-2')).toEqual({
      overrides: [{ permission: 'vehicle.odometer.write', effect: 'allow' }],
      roles: [builtInRoleId('viewer')],
    });
    expect(result.grants).toEqual({ reapplied: 1, dropped: [] });
    expect(await can('member-2', 'vehicle.share.manage')).toBe(false);
  });

  test('grants that are no longer valid are dropped instead of re-applied', async () => {
    await addMember('member-3');
    await addMember('gone-grantor');
    await addMember('disabled-1');
    await ctx.sql.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other-owner', 'o@test.com', 'o')"
    );
    await ctx.sql.run(
      "INSERT INTO roles (id, scope, name, built_in, owner_user_id) VALUES ('foreign-role', 'vehicle', 'Theirs', FALSE, 'other-owner')"
    );
    await override('member-3', 'vehicle.delete');
    await assign('member-3', 'foreign-role');
    await override('member-3', 'vehicle.trip.write', 'gone-grantor');
    await override('disabled-1', 'vehicle.trip.write');
    await ctx.sql.run('UPDATE users SET disabled_at = 1 WHERE id = ?', ['disabled-1']);
    await addMember('waiting-1');
    await assign('waiting-1', CUSTOM_ROLE);
    await ctx.sql.run('UPDATE users SET pending_approval_at = 1 WHERE id = ?', ['waiting-1']);
    const zip = new AdmZip(await exportZip());
    const shares = zip.getEntry('vehicle_shares.csv')?.getData().toString('utf-8') ?? '';
    zip.updateFile(
      'vehicle_shares.csv',
      Buffer.from(
        shares
          .split('\n')
          .filter((line) => !line.includes('gone-grantor'))
          .join('\n'),
        'utf-8'
      )
    );

    const result = await restore(zip.toBuffer());

    expect((await grantsOf('member-3')).overrides).toEqual([]);
    expect((await grantsOf('member-3')).roles).toEqual([builtInRoleId('viewer')]);
    expect((await grantsOf('disabled-1')).overrides).toEqual([]);
    expect(result.grants?.reapplied).toBe(0);
    expect([...(result.grants?.dropped ?? [])].map((d) => `${d.kind} ${d.reason}`).sort()).toEqual([
      'override granted_by_non_member',
      'override permission_not_grantable',
      'override person_not_active',
      'role person_not_active',
      'role role_not_assignable',
    ]);
    expect((await grantsOf('waiting-1')).roles).toEqual([builtInRoleId('viewer')]);
  });

  test('a restore that brings back none of the cars drops every grant on them', async () => {
    await addMember('member-4');
    await override('member-4', 'vehicle.expense.write');
    const zip = new AdmZip(await exportZip());
    for (const entry of ['vehicles.csv']) {
      const text = zip.getEntry(entry)?.getData().toString('utf-8') ?? '';
      zip.updateFile(entry, Buffer.from(text.replaceAll(vehicleId, 'another-car'), 'utf-8'));
    }
    const shares = zip.getEntry('vehicle_shares.csv')?.getData().toString('utf-8') ?? '';
    zip.updateFile(
      'vehicle_shares.csv',
      Buffer.from(shares.replaceAll(vehicleId, 'another-car'), 'utf-8')
    );

    const result = await restore(zip.toBuffer());

    expect(result.grants).toEqual({
      reapplied: 0,
      dropped: [{ kind: 'override', vehicleId, reason: 'vehicle_not_restored' }],
    });
    expect(
      await ctx.sql.all('SELECT id FROM permission_overrides WHERE user_id = ?', ['member-4'])
    ).toEqual([]);
  });

  test('a deny always comes back with its car, so a restore never widens access', async () => {
    await addMember('limited-1');
    await addMember('setter-1');
    await addMember('limited-2');
    await override('limited-1', 'vehicle.photo.read', 'setter-1', 'deny');
    await override('limited-1', 'vehicle.expense.read', ctx.user.id, 'deny');
    await ctx.sql.run(
      "UPDATE permission_overrides SET set_by = NULL WHERE user_id = 'limited-1' AND permission = 'vehicle.expense.read'"
    );
    await override('limited-2', 'vehicle.trip.read', ctx.user.id, 'deny');
    await ctx.sql.run('UPDATE users SET disabled_at = 1 WHERE id = ?', ['limited-2']);
    const zip = new AdmZip(await exportZip());
    const shares = zip.getEntry('vehicle_shares.csv')?.getData().toString('utf-8') ?? '';
    zip.updateFile(
      'vehicle_shares.csv',
      Buffer.from(
        shares
          .split('\n')
          .filter((line) => !line.includes('setter-1'))
          .join('\n'),
        'utf-8'
      )
    );

    const result = await restore(zip.toBuffer());

    expect(result.grants).toEqual({ reapplied: 3, dropped: [] });
    expect((await grantsOf('limited-1')).overrides).toEqual([
      { permission: 'vehicle.expense.read', effect: 'deny' },
      { permission: 'vehicle.photo.read', effect: 'deny' },
    ]);
    expect((await grantsOf('limited-2')).overrides).toEqual([
      { permission: 'vehicle.trip.read', effect: 'deny' },
    ]);
    expect(await can('limited-1', 'vehicle.photo.read')).toBe(false);
    expect(await can('limited-1', 'vehicle.expense.read')).toBe(false);
  });

  test('a deny on someone with no share left on the car is cleaned up, one on an open invite stays', async () => {
    await addMember('left-1');
    await addMember('invited-1');
    await override('left-1', 'vehicle.trip.read', ctx.user.id, 'deny');
    await override('invited-1', 'vehicle.trip.read', ctx.user.id, 'deny');
    const zip = new AdmZip(await exportZip());
    const shares = zip.getEntry('vehicle_shares.csv')?.getData().toString('utf-8') ?? '';
    zip.updateFile(
      'vehicle_shares.csv',
      Buffer.from(
        shares
          .split('\n')
          .filter((line) => !line.includes('left-1'))
          .join('\n'),
        'utf-8'
      )
    );
    await ctx.sql.run("UPDATE vehicle_shares SET status = 'pending' WHERE shared_with_id = ?", [
      'invited-1',
    ]);

    const result = await restore(zip.toBuffer());

    expect(result.grants).toEqual({
      reapplied: 1,
      dropped: [{ kind: 'override', vehicleId, reason: 'person_not_active' }],
    });
    expect((await grantsOf('left-1')).overrides).toEqual([]);
    expect((await grantsOf('invited-1')).overrides).toEqual([
      { permission: 'vehicle.trip.read', effect: 'deny' },
    ]);
  });

  test('merge and preview restores leave per-person grants alone and report none', async () => {
    await addMember('member-5');
    await override('member-5', 'vehicle.expense.write');
    const zip = await exportZip();
    const { restoreService } = await import('../restore');

    for (const mode of ['merge', 'preview'] as const) {
      const result = await restoreService.restoreFromBackup(ctx.user.id, zip, mode);
      expect(result.success).toBe(true);
      expect('grants' in result, mode).toBe(false);
    }
    expect((await grantsOf('member-5')).overrides).toEqual([
      { permission: 'vehicle.expense.write', effect: 'allow' },
    ]);
  });
});
