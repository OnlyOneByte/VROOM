import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function createVehicle(make: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make, model: 'X', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

describe('restore merge conflict detection is tenant-scoped (cross-tenant read guard)', () => {
  test("a backup vehicle id colliding with ANOTHER user's row reports NO conflict (no leak)", async () => {
    const myVehicleId = await createVehicle('Honda');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const AdmZip = (await import('adm-zip')).default;
    const zip = await backupService.exportAsZip(ctx.user.id);

    const { db } = await import('../../../db/connection');
    const schema = await import('../../../db/schema');
    const victimId = 'victim-user-1';
    const victimVehicleId = 'victim-vehicle-secret-1';
    await db
      .insert(schema.users)
      .values({ id: victimId, email: 'victim@test.com', displayName: 'Victim' });
    await db.insert(schema.vehicles).values({
      id: victimVehicleId,
      userId: victimId,
      make: 'Ferrari',
      model: 'F8',
      year: 2023,
    });

    const archive = new AdmZip(zip);
    const csv = archive.getEntry('vehicles.csv')?.getData().toString('utf-8') as string;
    expect(csv, 'export contains vehicles.csv').toBeTruthy();
    const tampered = csv.split(myVehicleId).join(victimVehicleId);
    expect(tampered.includes(victimVehicleId), 'tamper replaced the id').toBe(true);
    archive.updateFile('vehicles.csv', Buffer.from(tampered, 'utf-8'));

    let conflicts: NonNullable<
      Awaited<ReturnType<typeof restoreService.restoreFromBackup>>['conflicts']
    > = [];
    try {
      const result = await restoreService.restoreFromBackup(
        ctx.user.id,
        archive.toBuffer(),
        'merge'
      );
      conflicts = result.conflicts ?? [];
    } catch (err) {
      expect(JSON.stringify(err instanceof Error ? err.message : err)).not.toContain('Ferrari');
    }

    const leaked = conflicts.some(
      (c) =>
        c.id === victimVehicleId ||
        JSON.stringify(c.localData ?? {}).includes('Ferrari') ||
        JSON.stringify(c.localData ?? {}).includes(victimId)
    );
    expect(leaked, "victim's row must not be echoed in conflicts").toBe(false);

    const victimRows = ctx.sqlite
      .query('SELECT make FROM vehicles WHERE id = ?')
      .all(victimVehicleId) as { make: string }[];
    expect(victimRows).toHaveLength(1);
    expect(victimRows[0].make).toBe('Ferrari');
  });

  test('a genuine SELF-collision still reports a conflict (feature intact)', async () => {
    const myVehicleId = await createVehicle('Toyota');
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'merge');

    expect(result.success).toBe(false);
    const conflicts = result.conflicts ?? [];
    const mine = conflicts.find((c) => c.id === myVehicleId);
    expect(mine, 'self-collision is still detected').toBeTruthy();
    expect(mine?.table).toBe('vehicles');
  });
});
