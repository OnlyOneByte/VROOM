import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { appContext, createAppContext } from '../app-context';
import { applyMigrationsUpTo, loadMigrations } from '../db/__tests__/migration-helpers';
import { getDb, transaction } from '../db/connection';
import * as schema from '../db/schema';

function isolatedDb() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  applyMigrationsUpTo(sqlite, migrations, migrations.length - 1);
  sqlite.run(
    "INSERT INTO users (id, email, display_name) VALUES ('ctx-user', 'ctx@test.com', 'Ctx')"
  );
  sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('ctx-vehicle', 'ctx-user', 'Honda', 'Civic', 2023)"
  );
  return drizzle(sqlite, { schema });
}

describe('the app context', () => {
  test('importing any production module opens no database', () => {
    const modules = [...new Bun.Glob('src/**/*.ts').scanSync(join(import.meta.dir, '../..'))]
      .filter((f) => !/__tests__|test-helpers|\/scripts\/|\.d\.ts$|^src\/index\.ts$/.test(f))
      .map((f) => `./${f}`);
    expect(modules).toContain('./src/api/providers/sync-worker.ts');
    const dir = mkdtempSync(join(tmpdir(), 'vroom-import-'));
    try {
      const file = join(dir, 'never-opened.db');
      const run = Bun.spawnSync(
        [
          process.execPath,
          '--env-file=/dev/null',
          '-e',
          'for (const m of JSON.parse(process.env.MODULES)) await import(m); process.exit(0)',
        ],
        {
          cwd: join(import.meta.dir, '../..'),
          env: { ...process.env, DATABASE_URL: file, MODULES: JSON.stringify(modules) },
        }
      );
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test('is built once, on the configured database', () => {
    expect(appContext()).toBe(appContext());
    expect(appContext().db).toBe(getDb());
  });

  test('its repositories write to the database they were given, transactions included', async () => {
    const db = isolatedDb();
    const created = await createAppContext(db).repos.reminders.createWithVehicles(
      {
        userId: 'ctx-user',
        name: 'Registration',
        type: 'notification',
        frequency: 'yearly',
        startDate: new Date('2024-02-01T00:00:00.000Z'),
      } as Parameters<
        ReturnType<typeof createAppContext>['repos']['reminders']['createWithVehicles']
      >[0],
      ['ctx-vehicle']
    );
    expect(created.vehicleIds).toEqual(['ctx-vehicle']);
    expect(db.$client.query('SELECT count(*) AS n FROM reminder_vehicles').get()).toEqual({ n: 1 });
  });

  test('transaction() runs on the database it is handed', async () => {
    const db = isolatedDb();
    const ids = await transaction(
      (tx) => tx.select({ id: schema.vehicles.id }).from(schema.vehicles).all(),
      db
    );
    expect(ids).toEqual([{ id: 'ctx-vehicle' }]);
  });
});
