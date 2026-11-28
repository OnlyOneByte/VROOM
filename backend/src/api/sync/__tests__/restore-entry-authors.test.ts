import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import AdmZip from 'adm-zip';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedCar, shareCar } from '../../../test-helpers/members';

let ctx: TestApp;
const CAR = 'authors-car';

function authorOf(table: string, id: string): string | null {
  return (
    ctx.sqlite.query(`SELECT created_by FROM ${table} WHERE id = ?`).get(id) as {
      created_by: string | null;
    }
  ).created_by;
}

function forgeAuthor(zip: AdmZip, file: string, rowId: string, author: string): void {
  const csv = zip.getEntry(file)?.getData().toString('utf-8') ?? '';
  const [header = '', ...lines] = csv.trimEnd().split('\n');
  const authorColumn = header.split(',').findIndex((h) => h.replace(/"/g, '') === 'createdBy');
  const forged = lines.map((line) => {
    if (!line.includes(`"${rowId}"`)) return line;
    const cells = line.split(',');
    cells[authorColumn] = `"${author}"`;
    return cells.join(',');
  });
  zip.updateFile(file, Buffer.from(`${[header, ...forged].join('\n')}\n`, 'utf-8'));
}

async function restore(zip: Buffer): Promise<void> {
  const { restoreService } = await import('../restore');
  const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
  expect(result.success, JSON.stringify(result)).toBe(true);
}

async function exportZip(): Promise<AdmZip> {
  const { backupService } = await import('../backup');
  return new AdmZip(await backupService.exportAsZip(ctx.user.id));
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('restore keeps an entry author only while they are a member of the car', () => {
  test('a crafted backup naming a non-member as author gives them no delete right', async () => {
    const outsider = await createInvitee(ctx, 'authors-outsider');
    ctx.sqlite.run(
      'INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES (?, ?, ?, 1000, 1717200000)',
      ['owners-reading', CAR, ctx.user.id]
    );
    const zip = await exportZip();
    forgeAuthor(zip, 'odometer.csv', 'owners-reading', outsider.id);

    await restore(zip.toBuffer());

    expect(authorOf('odometer_entries', 'owners-reading')).toBeNull();
    await shareCar(ctx, CAR, outsider, 'editor');
    expect((await outsider.request('DELETE', '/api/v1/odometer/owners-reading')).status).toBe(403);
  });

  test('a real editor entry keeps its author through backup and restore', async () => {
    const editor = await createInvitee(ctx, 'authors-editor');
    await shareCar(ctx, CAR, editor, 'editor');
    const added = await editor.request('POST', `/api/v1/odometer/${CAR}`, {
      odometer: 2000,
      recordedAt: '2024-07-01T00:00:00.000Z',
    });
    expect(added.status).toBe(201);
    const { id } = ((await added.json()) as { data: { id: string } }).data;

    await restore((await exportZip()).toBuffer());

    expect(authorOf('odometer_entries', id)).toBe(editor.id);
    expect((await editor.request('DELETE', `/api/v1/odometer/${id}`)).status).toBe(200);
  });

  test('trips and photos keep a member author and drop a non-member one', async () => {
    const editor = await createInvitee(ctx, 'authors-trip-editor');
    const outsider = await createInvitee(ctx, 'authors-photo-outsider');
    await shareCar(ctx, CAR, editor, 'editor');
    ctx.sqlite.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date, created_by) VALUES ('editors-trip', ?, ?, 10, 20, 'business', 1717200000, ?)",
      [CAR, ctx.user.id, editor.id]
    );
    ctx.sqlite.run(
      "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, created_by) VALUES ('forged-photo', ?, 'vehicle', ?, 'a.jpg', 'image/jpeg', 10, ?)",
      [ctx.user.id, CAR, outsider.id]
    );

    await restore((await exportZip()).toBuffer());

    expect(authorOf('trips', 'editors-trip')).toBe(editor.id);
    expect(authorOf('photos', 'forged-photo')).toBeNull();
  });
});
