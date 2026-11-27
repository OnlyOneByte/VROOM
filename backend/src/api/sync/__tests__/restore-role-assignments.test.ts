import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { appContext } from '../../../app-context';
import { getDb } from '../../../db/connection';
import {
  assignServerRole,
  builtInRoleId,
  grantShareRole,
  syncResolverFor,
} from '../../../permissions/grants';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let vehicleId: string;

beforeEach(async () => {
  ctx = await createTestApp();
  vehicleId = await seedVehicle(ctx);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedMember(id: string, level: string, status: string): Promise<void> {
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    `${id}@test.com`,
    id,
  ]);
  await assignServerRole(appContext().asyncDb, id, 'member');
  ctx.sqlite.run(
    `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    [`share-${id}`, vehicleId, ctx.user.id, id, level, status]
  );
  if (status === 'accepted') {
    await grantShareRole(appContext().asyncDb, {
      vehicleId,
      sharedWithId: id,
      level,
      grantedBy: ctx.user.id,
    });
  }
}

function vehicleRoles(userId: string): string[] {
  return (
    ctx.sqlite
      .query('SELECT role_id FROM role_assignments WHERE user_id = ? AND scope_id IS NOT NULL')
      .all(userId) as { role_id: string }[]
  ).map((row) => row.role_id);
}

function csv(rows: Record<string, string>[]): Buffer {
  const columns = Object.keys(rows[0] ?? {});
  const line = (values: string[]) => values.map((v) => `"${v}"`).join(',');
  return Buffer.from(
    [line(columns), ...rows.map((row) => line(columns.map((c) => row[c] ?? '')))].join('\n')
  );
}

async function restore(zip: Buffer): Promise<void> {
  const { restoreService } = await import('../restore');
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

async function exportZip(): Promise<Buffer> {
  const { backupService } = await import('../backup');
  return backupService.exportAsZip(ctx.user.id);
}

describe('restore re-creates role assignments from restored accepted shares only', () => {
  test('accepted editor and viewer shares come back with their role', async () => {
    await seedMember('editor-1', 'editor', 'accepted');
    await seedMember('viewer-1', 'viewer', 'accepted');
    const zip = await exportZip();

    await restore(zip);

    expect(vehicleRoles('editor-1')).toEqual([builtInRoleId('editor')]);
    expect(vehicleRoles('viewer-1')).toEqual([builtInRoleId('viewer')]);
  });

  test('pending and declined shares grant no role', async () => {
    await seedMember('pending-1', 'editor', 'pending');
    await seedMember('declined-1', 'editor', 'declined');

    await restore(await exportZip());

    expect(vehicleRoles('pending-1')).toEqual([]);
    expect(vehicleRoles('declined-1')).toEqual([]);
  });

  test('a crafted backup claiming an accepted share for someone who never accepted grants no role', async () => {
    await seedMember('never-accepted-1', 'editor', 'declined');
    const zip = new AdmZip(await exportZip());
    const shares = zip.getEntry('vehicle_shares.csv')?.getData().toString('utf-8') ?? '';
    const [header = ''] = shares.split('\n');
    const row: Record<string, string> = {
      id: 'forged-share',
      vehicleId,
      ownerId: ctx.user.id,
      sharedWithId: 'never-accepted-1',
      level: 'editor',
      status: 'accepted',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const line = header
      .split(',')
      .map((column) => `"${row[column.replace(/^"|"$/g, '')] ?? ''}"`)
      .join(',');
    zip.updateFile('vehicle_shares.csv', Buffer.from(`${header}\n${line}\n`, 'utf-8'));

    await restore(zip.toBuffer());

    const status = ctx.sqlite
      .query("SELECT status FROM vehicle_shares WHERE id = 'forged-share'")
      .get();
    expect(status).toEqual({ status: 'pending' });
    expect(vehicleRoles('never-accepted-1')).toEqual([]);
  });

  test('role, assignment and override rows in a crafted backup are ignored', async () => {
    await seedMember('stranger-1', 'viewer', 'declined');
    const zip = new AdmZip(await exportZip());
    zip.addFile(
      'roles.csv',
      csv([{ id: 'forged-role', scope: 'server', key: 'admin', name: 'Admin', builtIn: 'true' }])
    );
    zip.addFile(
      'role_permissions.csv',
      csv([{ roleId: 'forged-role', permission: 'server.roles.manage' }])
    );
    zip.addFile(
      'role_assignments.csv',
      csv([
        { id: 'forged-a1', userId: ctx.user.id, roleId: builtInRoleId('admin'), scopeId: '' },
        {
          id: 'forged-a2',
          userId: 'stranger-1',
          roleId: builtInRoleId('co_owner'),
          scopeId: vehicleId,
        },
      ])
    );
    zip.addFile(
      'permission_overrides.csv',
      csv([
        {
          id: 'forged-o1',
          userId: 'stranger-1',
          scope: 'vehicle',
          scopeId: vehicleId,
          permission: 'vehicle.read',
          effect: 'allow',
        },
      ])
    );

    await restore(zip.toBuffer());

    expect(ctx.sqlite.query('SELECT id FROM roles WHERE built_in = 0').all()).toEqual([]);
    expect(
      ctx.sqlite.query("SELECT id FROM role_assignments WHERE id LIKE 'forged-%'").all()
    ).toEqual([]);
    expect(ctx.sqlite.query('SELECT id FROM permission_overrides').all()).toEqual([]);
    expect(vehicleRoles('stranger-1')).toEqual([]);
    const db = getDb();
    expect(
      syncResolverFor(db, ctx.user.id).can('server.roles.manage', { kind: 'server' }).allow
    ).toBe(false);
    expect(
      syncResolverFor(db, 'stranger-1').can('vehicle.read', { kind: 'vehicle', vehicleId })
    ).toEqual({ allow: false, reason: 'not_found' });
  });
});
