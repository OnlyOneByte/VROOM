import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
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

function photoIds(): string[] {
  return (ctx.sqlite.query('SELECT id FROM photos ORDER BY id').all() as { id: string }[]).map(
    (r) => r.id
  );
}

describe('an orphaned photo row does not make backups unrestorable', () => {
  test('deleting a trip orphans its odometer photo; the next backup still restores', async () => {
    const vehRes = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Kia',
      model: 'Niro',
      year: 2021,
    });
    const vehicle = await json<DataEnvelope<{ id: string }>>(vehRes);
    expect(vehRes.status, JSON.stringify(vehicle)).toBe(201);

    const tripRes = await ctx.authed('POST', '/api/v1/trips', {
      vehicleId: vehicle.data.id,
      startOdometer: 1000,
      endOdometer: 1100,
      purpose: 'business',
      tripDate: '2026-06-01T00:00:00.000Z',
    });
    const trip = await json<DataEnvelope<{ id: string }>>(tripRes);
    expect(tripRes.status, JSON.stringify(trip)).toBe(201);
    const odometer = ctx.sqlite.query('SELECT id FROM odometer_entries').get() as { id: string };
    expect(odometer, 'trip auto-creates an odometer entry').toBeTruthy();

    ctx.sqlite.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-odo', ?, 'odometer_entry', ?, 'dash.jpg', 'image/jpeg', 2048),
              ('photo-car', ?, 'vehicle', ?, 'car.jpg', 'image/jpeg', 4096)`,
      [ctx.user.id, odometer.id, ctx.user.id, vehicle.data.id]
    );

    ctx.sqlite.run('DELETE FROM odometer_entries WHERE id = ?', [odometer.id]);
    expect(photoIds(), 'a legacy orphan left by an older build').toEqual([
      'photo-car',
      'photo-odo',
    ]);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);

    const preview = await restoreService.restoreFromBackup(ctx.user.id, zip, 'preview');
    expect(preview.preview?.photos).toBe(1);
    expect(preview.skipped, 'the user is told before confirming').toEqual({ photos: 1 });

    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.skipped).toEqual({ photos: 1 });
    expect(photoIds()).toEqual(['photo-car']);
  });

  test('an old-format 1.0.0 ZIP carrying an orphan photo and its ref restores without them', async () => {
    const userId = ctx.user.id;
    const zip = new AdmZip();
    zip.addFile(
      'metadata.json',
      Buffer.from(
        JSON.stringify({ version: '1.0.0', timestamp: new Date(0).toISOString(), userId }),
        'utf-8'
      )
    );
    zip.addFile(
      'vehicles.csv',
      Buffer.from(`id,userId,make,model,year\n"v1","${userId}","Ford","Focus","2012"\n`, 'utf-8')
    );
    zip.addFile(
      'photos.csv',
      Buffer.from(
        `id,userId,entityType,entityId,fileName,mimeType,fileSize\n"p-ok","${userId}","vehicle","v1","a.jpg","image/jpeg","1"\n"p-orphan","${userId}","expense","gone","b.jpg","image/jpeg","1"\n`,
        'utf-8'
      )
    );
    zip.addFile(
      'photo_refs.csv',
      Buffer.from(
        'id,photoId,providerId,externalId,status\n"r-orphan","p-orphan","prov-x","ext","active"\n',
        'utf-8'
      )
    );
    for (const f of ['expenses.csv', 'vehicle_financing.csv', 'insurance_policies.csv']) {
      zip.addFile(f, Buffer.from('id\n', 'utf-8'));
    }

    const { restoreService } = await import('../restore');
    const result = await restoreService.restoreFromBackup(userId, zip.toBuffer(), 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(photoIds()).toEqual(['p-ok']);
  });

  test("a shared-vehicle editor's receipt on the owner's expense survives the editor's replace restore", async () => {
    const ownerVehicle = await ctx.authed('POST', '/api/v1/vehicles', {
      make: 'Volvo',
      model: 'V60',
      year: 2020,
    });
    const vehicle = await json<DataEnvelope<{ id: string }>>(ownerVehicle);
    expect(ownerVehicle.status, JSON.stringify(vehicle)).toBe(201);
    const editorId = 'editor-user';
    ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      editorId,
      'editor@test.com',
      'Editor',
    ]);
    ctx.sqlite.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, created_by, category, date, expense_amount)
       VALUES ('exp-shared', ?, ?, ?, 'fuel', 1700000000, 3000)`,
      [vehicle.data.id, ctx.user.id, editorId]
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v-editor', ?, 'Mini', 'Cooper', 2019)`,
      [editorId]
    );
    ctx.sqlite.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-receipt', ?, 'expense', 'exp-shared', 'r.jpg', 'image/jpeg', 1),
              ('photo-own', ?, 'vehicle', 'v-editor', 'c.jpg', 'image/jpeg', 1)`,
      [editorId, editorId]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(editorId);
    const result = await restoreService.restoreFromBackup(editorId, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    expect(photoIds(), "the owner's receipt is not wiped by the editor's restore").toEqual([
      'photo-own',
      'photo-receipt',
    ]);
  });

  test('a photo with an unknown entity type still fails validation', async () => {
    const { backupService } = await import('../backup');
    const backup = {
      metadata: { version: '2.0.0', timestamp: new Date(0).toISOString(), userId: 'u1' },
      vehicles: [],
      expenses: [],
      financing: [],
      insurance: [],
      photos: [{ id: 'p1', entityType: 'spaceship', entityId: 'x' }],
      photoRefs: [],
    } as unknown as Parameters<typeof backupService.dropOrphanPhotos>[0];
    const cleaned = backupService.dropOrphanPhotos(backup);
    expect(cleaned.photos).toHaveLength(1);
    expect(backupService.validateBackupData(cleaned).errors.join('\n')).toContain(
      'unknown entity type'
    );
  });
});
