import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getColumnNames } from '../../../db/__tests__/migration-helpers';
import {
  createTestDb,
  seedExpense,
  seedUser,
  type TestDb,
} from '../../analytics/__tests__/analytics-test-generators';
import { firstRunDelayMs, refreshCommunityStats } from '../aggregator';
import { CommunityStatsRepository } from '../repository';
import { NOW } from './community-fixtures';

const DAY = 86_400_000;
let db: TestDb;
let repository: CommunityStatsRepository;

function seedOwner(sqlite: Database, id: string, optIn: boolean): void {
  seedUser(sqlite, { id, email: `${id}@example.com`, displayName: id });
  sqlite.run('INSERT INTO user_preferences (user_id, community_stats_opt_in) VALUES (?, ?)', [
    id,
    optIn ? 1 : 0,
  ]);
  sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year, vin, license_plate, catalog_model_id) VALUES (?, ?, 'Honda', 'Civic', 2019, ?, ?, 'honda-civic')",
    [`${id}-car`, id, `VIN${id}`, `PLATE-${id}`]
  );
  for (let i = 0; i < 6; i++) {
    seedExpense(sqlite, {
      id: `${id}-fuel-${i}`,
      vehicleId: `${id}-car`,
      category: 'fuel',
      expenseAmount: 4000,
      date: new Date(NOW.getTime() - (6 - i) * 20 * DAY),
      mileage: 10_000 + i * 300,
      volume: 10,
      fuelType: 'Regular',
      missedFillup: false,
    });
  }
}

function efficiencyRows() {
  return db.sqlite
    .query(
      "SELECT n_published FROM community_stats WHERE scope = 'local' AND metric = 'efficiency'"
    )
    .all() as { n_published: number }[];
}

function setOptIn(id: string, optIn: boolean): void {
  db.sqlite.run('UPDATE user_preferences SET community_stats_opt_in = ? WHERE user_id = ?', [
    optIn ? 1 : 0,
    id,
  ]);
}

beforeEach(() => {
  db = createTestDb();
  repository = new CommunityStatsRepository(db.drizzle);
});

afterEach(() => {
  db.sqlite.close();
});

describe('community stats refresh against the database', () => {
  test('owners who have not opted in are never counted', async () => {
    for (let i = 0; i < 9; i++) seedOwner(db.sqlite, `in-${i}`, true);
    for (let i = 0; i < 5; i++) seedOwner(db.sqlite, `out-${i}`, false);

    const result = await refreshCommunityStats(repository, NOW);

    expect(efficiencyRows()).toEqual([]);
    expect(result.suppressed).toBeGreaterThan(0);
  });

  test('opting in shows up on the next run, and a withdrawal drops out on the next run', async () => {
    for (let i = 0; i < 9; i++) seedOwner(db.sqlite, `in-${i}`, true);
    seedOwner(db.sqlite, 'late', false);
    await refreshCommunityStats(repository, NOW);
    expect(efficiencyRows()).toEqual([]);

    setOptIn('late', true);
    expect(efficiencyRows()).toEqual([]);
    await refreshCommunityStats(repository, NOW);
    expect(efficiencyRows()).toEqual([{ n_published: 10 }]);

    setOptIn('in-0', false);
    expect(efficiencyRows()).toEqual([{ n_published: 10 }]);
    await refreshCommunityStats(repository, NOW);
    expect(efficiencyRows()).toEqual([]);
  });

  test('each run replaces the local rows and never stores identifiers', async () => {
    for (let i = 0; i < 10; i++) seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW);
    await refreshCommunityStats(repository, new Date(NOW.getTime() + DAY));

    const rows = db.sqlite.query('SELECT * FROM community_stats').all() as Record<
      string,
      unknown
    >[];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.bucket_key)).size).toBe(rows.length);
    const text = JSON.stringify(rows);
    for (const secret of ['in-0', 'VINin', 'PLATE-', 'example.com']) {
      expect(text).not.toContain(secret);
    }
  });

  test('records from before the window let maintenance count, read end to end', async () => {
    for (let i = 0; i < 10; i++) seedOwner(db.sqlite, `in-${i}`, true);
    const maintenance = () =>
      db.sqlite
        .query("SELECT n_published FROM community_stats WHERE metric = 'maintenance'")
        .all() as { n_published: number }[];
    await refreshCommunityStats(repository, NOW);
    expect(maintenance()).toEqual([]);

    for (let i = 0; i < 10; i++) {
      seedExpense(db.sqlite, {
        id: `in-${i}-old`,
        vehicleId: `in-${i}-car`,
        category: 'maintenance',
        expenseAmount: 12_000,
        date: new Date(NOW.getTime() - 400 * DAY),
        mileage: 9_000,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
    }
    await refreshCommunityStats(repository, NOW);
    expect(maintenance()).toEqual([{ n_published: 10 }]);
  });

  test('publishedBuckets filters out rows below the minimum group in the query itself', async () => {
    for (const [key, n] of [
      ['a', 5],
      ['b', 10],
      ['c', 25],
    ] as const) {
      db.sqlite.run(
        "INSERT INTO community_stats (id, scope, metric, bucket_key, unit, n_published, mean, p50, computed_at, schema_version) VALUES (?, 'local', 'efficiency', ?, 'km_per_l', ?, 12, 12, 0, 1)",
        [key, key, n]
      );
    }
    const keys = ['a', 'b', 'c'];
    expect(
      (await repository.publishedBuckets('local', keys, 10)).map((r) => r.bucketKey).sort()
    ).toEqual(['b', 'c']);
    expect((await repository.publishedBuckets('local', keys, 15)).map((r) => r.bucketKey)).toEqual([
      'c',
    ]);
    expect(await repository.publishedBuckets('global', keys, 10)).toEqual([]);
  });

  test('the table has no user id column', () => {
    expect(getColumnNames(db.sqlite, 'community_stats').some((name) => name.includes('user'))).toBe(
      false
    );
  });

  test('the job runs at once with no snapshot or a stale one, and otherwise waits', () => {
    expect(firstRunDelayMs(null, NOW)).toBe(0);
    expect(firstRunDelayMs(new Date(NOW.getTime() - 2 * DAY), NOW)).toBe(0);
    expect(firstRunDelayMs(new Date(NOW.getTime() - DAY / 2), NOW)).toBe(DAY / 2);
  });
});
