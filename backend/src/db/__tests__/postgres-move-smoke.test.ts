import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { CONFIG } from '../../config';
import { seedGarage } from '../../db/seed';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../test-helpers/http-client';
import { compareBackups, exportBackup, MOVE_ORIGIN, restoreBackup } from '../postgres-move-smoke';

let ctx: TestApp;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let session: string;

beforeEach(async () => {
  if (!CONFIG.cors.origins.includes(MOVE_ORIGIN)) CONFIG.cors.origins.push(MOVE_ORIGIN);
  ctx = await createTestApp();
  await seedGarage(ctx.user.id);
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: ctx.app.fetch });
  base = `http://127.0.0.1:${server.port}`;
  session = ctx.cookie.split('=')[1] ?? '';
}, SETUP_TIMEOUT_MS);

afterEach(async () => {
  await server.stop(true);
  ctx.close();
});

describe('the SQLite to Postgres move script', () => {
  test('a backup restored with Replace All keeps every table row count', async () => {
    const dir = process.env.KIROCREW_SCRATCH ?? process.env.TMPDIR ?? '/tmp';
    const before = join(dir, `move-before-${process.pid}.zip`);
    const after = join(dir, `move-after-${process.pid}.zip`);
    await exportBackup(base, session, before);
    await restoreBackup(base, session, before);
    await exportBackup(base, session, after);
    expect(compareBackups(before, after)).toEqual([]);
  }, 60_000);

  test('a backup with rows missing after the move is reported table by table', async () => {
    const dir = process.env.KIROCREW_SCRATCH ?? process.env.TMPDIR ?? '/tmp';
    const before = join(dir, `move-full-${process.pid}.zip`);
    const after = join(dir, `move-empty-${process.pid}.zip`);
    await exportBackup(base, session, before);
    const zip = new AdmZip(before);
    const entry = zip.getEntry('expenses.csv');
    const header = entry?.getData().toString('utf-8').split('\n')[0] ?? '';
    zip.updateFile('expenses.csv', Buffer.from(`${header}\n`, 'utf-8'));
    zip.writeZip(after);
    const differences = compareBackups(before, after);
    expect(differences).toHaveLength(1);
    expect(differences[0]).toMatch(/^expenses\.csv: \d+ on SQLite, 0 on Postgres$/);
  }, 60_000);
});
