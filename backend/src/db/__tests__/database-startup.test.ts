import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type AppContext, appContext, installAppContext } from '../../app-context';
import { pgliteConnection } from '../async-postgres';
import {
  bunSqlStart,
  checkDatabaseHealth,
  databaseTarget,
  describeDatabase,
  runMigrations,
  startPostgres,
} from '../connection';
import { ACTIVE_DIALECT } from '../dialect/active';

const PASSWORD = 's3cretPW';

describe('DATABASE_URL', () => {
  test.each([
    ['./data/vroom.db', './data/vroom.db'],
    ['/app/data/vroom.db', '/app/data/vroom.db'],
    [':memory:', ':memory:'],
    ['C:\\vroom\\vroom.db', 'C:\\vroom\\vroom.db'],
    ['sqlite:./data/vroom.db', './data/vroom.db'],
    ['sqlite:///app/data/vroom.db', '/app/data/vroom.db'],
  ])('%s opens SQLite at %s', (url, path) => {
    expect(databaseTarget(url)).toEqual({ kind: 'sqlite', path });
  });

  test.each([
    'postgres://vroom:pw@db:5432/vroom',
    'postgresql://vroom@db/vroom',
    'POSTGRES://db/vroom',
  ])('%s opens Postgres', (url) => {
    expect(databaseTarget(url)).toEqual({ kind: 'pg', url });
  });

  test.each(['mysql://vroom:pw@db/vroom', 'file:./vroom.db', 'https://db.example/vroom'])(
    '%s is refused, naming only its scheme',
    (url) => {
      expect(() => databaseTarget(url)).toThrow(/unsupported scheme "[a-z]+:"/);
      expect(() => databaseTarget(url.replace('pw', PASSWORD))).not.toThrow(PASSWORD);
    }
  );

  test('a Postgres target is described without its user or password', () => {
    const where = describeDatabase(databaseTarget(`postgres://vroom:${PASSWORD}@db.internal/cars`));
    expect(where).toBe('Postgres at db.internal:5432/cars');
  });
});

describe('a Postgres server that cannot be reached', () => {
  test('stops startup quickly, saying where, without the password', async () => {
    const url = `postgres://vroom:${PASSWORD}@127.0.0.1:1/cars`;
    const started = Date.now();
    const failure = await startPostgres(bunSqlStart(url), describeDatabase(databaseTarget(url)))
      .then(() => null)
      .catch((error: unknown) => error as Error);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(failure?.message).toStartWith('Could not connect to Postgres at 127.0.0.1:1/cars: ');
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain(PASSWORD);
  }, 20_000);
});

describe.skipIf(ACTIVE_DIALECT !== 'pg')('startup on Postgres', () => {
  let client: PGlite | null = null;
  let before: AppContext | null = null;

  afterEach(async () => {
    if (before) installAppContext(before);
    await client?.close();
  });

  test('migrates, opens the app database, seeds the built-in roles and reports healthy', async () => {
    try {
      before = appContext();
    } catch {
      before = null;
    }
    const pglite = new PGlite();
    client = pglite;
    const opened: string[] = [];
    await runMigrations((url) => {
      opened.push(url);
      return {
        migrate: () =>
          migrate(drizzle(pglite), {
            migrationsFolder: join(import.meta.dir, '../../../drizzle-pg'),
          }),
        connect: async () => pgliteConnection(pglite),
      };
    });
    expect(opened).toEqual(['postgres://pglite.test/vroom']);
    expect(appContext()).not.toBe(before);
    const { rows } = await pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM roles');
    expect(rows[0]?.n).toBeGreaterThan(0);
    expect(await checkDatabaseHealth()).toBe(true);
  });
});
