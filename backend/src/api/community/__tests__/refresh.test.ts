import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { getColumnNames } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import { sqliteTestSql } from '../../../test-helpers/test-sql';
import { logger } from '../../../utils/logger';
import {
  seedExpense,
  seedInsurancePolicy,
  seedUser,
} from '../../analytics/__tests__/analytics-test-db';
import { createTestDb, type TestDb } from '../../analytics/__tests__/analytics-test-generators';
import {
  COMMUNITY_SCHEMA_VERSION,
  firstRunDelayMs,
  refreshCommunityStats,
  refreshSafely,
} from '../aggregator';
import { CommunityStatsRepository } from '../repository';
import { NO_NOISE, NOW } from './community-fixtures';

const DAY = 86_400_000;
const PERIOD = CONFIG.communityStats.releasePeriodMs;
let db: TestDb;
let repository: CommunityStatsRepository;

async function seedOwner(sqlite: Database, id: string, optIn: boolean): Promise<void> {
  await seedUser(sqliteTestSql(sqlite), { id, email: `${id}@example.com`, displayName: id });
  sqlite.run('INSERT INTO user_preferences (user_id, community_stats_opt_in) VALUES (?, ?)', [
    id,
    optIn ? 1 : 0,
  ]);
  sqlite.run(
    "INSERT INTO vehicles (id, user_id, make, model, year, vin, license_plate, catalog_model_id) VALUES (?, ?, 'Honda', 'Civic', 2019, ?, ?, 'honda-civic')",
    [`${id}-car`, id, `VIN${id}`, `PLATE-${id}`]
  );
  for (let i = 0; i < 6; i++) {
    await seedExpense(sqliteTestSql(sqlite), {
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

function memberRows() {
  return db.sqlite
    .query("SELECT * FROM community_release_members WHERE scope = 'local'")
    .all() as Record<string, unknown>[];
}

const RELEASE_DUE = {
  noiseKey: async () => 'key',
  lastRefreshedAt: async () => null,
  releaseOutdated: async () => false,
};

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function setOptIn(id: string, optIn: boolean): void {
  db.sqlite.run('UPDATE user_preferences SET community_stats_opt_in = ? WHERE user_id = ?', [
    optIn ? 1 : 0,
    id,
  ]);
}

beforeEach(() => {
  db = createTestDb();
  repository = new CommunityStatsRepository(openAsyncDatabase(db.drizzle.$client).db);
});

afterEach(() => {
  db.sqlite.close();
});

describe('community stats refresh against the database', () => {
  test('owners who have not opted in are never counted', async () => {
    for (let i = 0; i < 29; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    for (let i = 0; i < 5; i++) await seedOwner(db.sqlite, `out-${i}`, false);

    const result = await refreshCommunityStats(repository, NOW, NO_NOISE);

    expect(efficiencyRows()).toEqual([]);
    expect(result?.suppressed).toBeGreaterThan(0);
  });

  test('opting in counts from the next release, and opting out withdraws the groups on the next run', async () => {
    for (let i = 0; i < 29; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    await seedOwner(db.sqlite, 'late', false);
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    expect(efficiencyRows()).toEqual([]);

    setOptIn('late', true);
    await refreshCommunityStats(repository, at(DAY), NO_NOISE);
    expect(efficiencyRows()).toEqual([]);
    await refreshCommunityStats(repository, at(PERIOD), NO_NOISE);
    expect(efficiencyRows()).toEqual([{ n_published: 30 }]);

    setOptIn('in-0', false);
    expect(efficiencyRows()).toEqual([{ n_published: 30 }]);
    await refreshCommunityStats(repository, at(PERIOD + DAY), NO_NOISE);
    expect(efficiencyRows()).toEqual([]);
    expect(memberRows()).toEqual([]);
    expect(await repository.lastRefreshedAt('local')).toEqual(at(PERIOD));
  });

  test('a deleted account withdraws its groups on the next run', async () => {
    for (let i = 0; i < 30; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    expect(efficiencyRows()).toEqual([{ n_published: 30 }]);

    db.sqlite.run("DELETE FROM users WHERE id = 'in-3'");
    await refreshCommunityStats(repository, at(DAY), NO_NOISE);
    expect(efficiencyRows()).toEqual([]);
  });

  test("a group's figures stay as released until the period ends, even when its data changes", async () => {
    for (let i = 0; i < 40; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    const snapshot = () =>
      db.sqlite
        .query('SELECT bucket_key, n_published, mean FROM community_stats ORDER BY bucket_key')
        .all();
    await refreshCommunityStats(repository, NOW);
    const released = snapshot();
    expect(released.length).toBeGreaterThan(0);

    for (let i = 40; i < 60; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    for (const day of [DAY, 7 * DAY, PERIOD - DAY]) {
      expect(await refreshCommunityStats(repository, at(day))).toBeNull();
      expect(snapshot()).toEqual(released);
    }
    expect(await repository.lastRefreshedAt('local')).toEqual(NOW);

    expect(await refreshCommunityStats(repository, at(PERIOD))).not.toBeNull();
    expect(await repository.lastRefreshedAt('local')).toEqual(at(PERIOD));
  });

  test('rows released before groups recorded their owners are released again on the next run', async () => {
    for (let i = 0; i < 30; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    db.sqlite.run('DELETE FROM community_release_members');

    expect(await refreshCommunityStats(repository, at(DAY), NO_NOISE)).not.toBeNull();
    expect(new Set(memberRows().map((row) => row.member_tag)).size).toBe(30);
    expect(await repository.lastRefreshedAt('local')).toEqual(at(DAY));
  });

  test('rows stored under an older schema version are released again on the next run', async () => {
    for (let i = 0; i < 30; i++) seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    db.sqlite.run('UPDATE community_stats SET schema_version = ?', [COMMUNITY_SCHEMA_VERSION - 1]);

    expect(await refreshCommunityStats(repository, at(DAY), NO_NOISE)).not.toBeNull();
    expect(
      db.sqlite.query('SELECT DISTINCT schema_version AS v FROM community_stats').all()
    ).toEqual([{ v: COMMUNITY_SCHEMA_VERSION }]);
  });

  test('opting out and back in between releases keeps the withdrawn groups hidden until the next release', async () => {
    for (let i = 0; i < 30; i++) seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    expect(efficiencyRows()).toEqual([{ n_published: 30 }]);

    setOptIn('in-0', false);
    await refreshCommunityStats(repository, at(DAY), NO_NOISE);
    setOptIn('in-0', true);
    for (const day of [2 * DAY, PERIOD - DAY]) {
      expect(await refreshCommunityStats(repository, at(day), NO_NOISE)).toBeNull();
      expect(efficiencyRows()).toEqual([]);
    }
    await refreshCommunityStats(repository, at(PERIOD), NO_NOISE);
    expect(efficiencyRows()).toEqual([{ n_published: 30 }]);
  });

  test('the noise key is made once per scope, kept across runs, and never stored with the stats', async () => {
    const first = await repository.noiseKey('local');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    for (let i = 0; i < 30; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW);
    expect(await repository.noiseKey('local')).toBe(first);
    expect(await repository.noiseKey('other')).not.toBe(first);
    expect(JSON.stringify(db.sqlite.query('SELECT * FROM community_stats').all())).not.toContain(
      first
    );
  });

  test('a rerun over unchanged data publishes the same numbers', async () => {
    for (let i = 0; i < 40; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    const snapshot = () =>
      db.sqlite
        .query('SELECT bucket_key, n_published, mean FROM community_stats ORDER BY bucket_key')
        .all();
    await refreshCommunityStats(repository, NOW);
    const first = snapshot();
    await refreshCommunityStats(repository, NOW);
    expect(snapshot()).toEqual(first);
  });

  test('each run replaces the local rows and never stores identifiers', async () => {
    for (let i = 0; i < 30; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    await refreshCommunityStats(repository, new Date(NOW.getTime() + DAY), NO_NOISE);

    const rows = db.sqlite.query('SELECT * FROM community_stats').all() as Record<
      string,
      unknown
    >[];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.bucket_key)).size).toBe(rows.length);
    const text = JSON.stringify([rows, memberRows()]);
    expect(memberRows().length).toBeGreaterThan(0);
    for (const secret of ['in-0', 'VINin', 'PLATE-', 'example.com']) {
      expect(text).not.toContain(secret);
    }
  });

  test('records from before the window let maintenance count, read end to end', async () => {
    for (let i = 0; i < 30; i++) await seedOwner(db.sqlite, `in-${i}`, true);
    const maintenance = () =>
      db.sqlite
        .query("SELECT n_published FROM community_stats WHERE metric = 'maintenance'")
        .all() as { n_published: number }[];
    await refreshCommunityStats(repository, NOW, NO_NOISE);
    expect(maintenance()).toEqual([]);

    for (let i = 0; i < 30; i++) {
      await seedExpense(sqliteTestSql(db.sqlite), {
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
    await refreshCommunityStats(repository, at(PERIOD), NO_NOISE);
    expect(maintenance()).toEqual([{ n_published: 30 }]);
  });

  test('publishedBuckets filters out rows below the minimum group or from an older schema', async () => {
    for (const [key, n, version] of [
      ['a', 5, COMMUNITY_SCHEMA_VERSION],
      ['b', 10, COMMUNITY_SCHEMA_VERSION],
      ['c', 25, COMMUNITY_SCHEMA_VERSION],
      ['old', 25, COMMUNITY_SCHEMA_VERSION - 1],
    ] as const) {
      db.sqlite.run(
        "INSERT INTO community_stats (id, scope, metric, bucket_key, unit, n_published, mean, computed_at, schema_version) VALUES (?, 'local', 'efficiency', ?, 'km_per_l', ?, 12, 0, ?)",
        [key, key, n, version]
      );
    }
    const keys = ['a', 'b', 'c', 'old'];
    expect(
      (await repository.publishedBuckets('local', keys, 10)).map((r) => r.bucketKey).sort()
    ).toEqual(['b', 'c']);
    expect((await repository.publishedBuckets('local', keys, 15)).map((r) => r.bucketKey)).toEqual([
      'c',
    ]);
    expect(await repository.publishedBuckets('global', keys, 10)).toEqual([]);
  });

  test('only fuel and maintenance expenses load as expenses, and premiums come with their term', async () => {
    await seedOwner(db.sqlite, 'in-0', true);
    await seedInsurancePolicy(sqliteTestSql(db.sqlite), {
      id: 'pol',
      userId: 'in-0',
      company: 'Acme',
      isActive: true,
    });
    const unix = (days: number) => Math.floor((NOW.getTime() + days * DAY) / 1000);
    db.sqlite.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
      ['term-1', 'pol', unix(-500), unix(-135)]
    );
    await seedExpense(sqliteTestSql(db.sqlite), {
      id: 'premium',
      vehicleId: 'in-0-car',
      category: 'financial',
      expenseAmount: 90_000,
      date: new Date(NOW.getTime() - 500 * DAY),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
    db.sqlite.run(
      "UPDATE expenses SET source_type = 'insurance_term', source_id = 'term-1' WHERE id = 'premium'"
    );
    await seedUser(sqliteTestSql(db.sqlite), {
      id: 'stranger',
      email: 'stranger@example.com',
      displayName: 'S',
    });
    await seedInsurancePolicy(sqliteTestSql(db.sqlite), {
      id: 'pol-x',
      userId: 'stranger',
      company: 'X',
      isActive: true,
    });
    db.sqlite.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
      ['term-x', 'pol-x', unix(-100), unix(265)]
    );
    db.sqlite.run(
      'INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES (?, ?, ?, ?)',
      ['term-old', 'pol', unix(-900), unix(-400)]
    );
    for (const [id, termId] of [
      ['foreign-premium', 'term-x'],
      ['old-premium', 'term-old'],
    ] as const) {
      await seedExpense(sqliteTestSql(db.sqlite), {
        id,
        vehicleId: 'in-0-car',
        category: 'financial',
        expenseAmount: 70_000,
        date: new Date(NOW.getTime() - 100 * DAY),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
      db.sqlite.run(
        "UPDATE expenses SET source_type = 'insurance_term', source_id = ? WHERE id = ?",
        [termId, id]
      );
    }
    for (const [id, category] of [
      ['loan', 'financial'],
      ['parking', 'misc'],
    ] as const) {
      await seedExpense(sqliteTestSql(db.sqlite), {
        id,
        vehicleId: 'in-0-car',
        category,
        expenseAmount: 50_000,
        date: new Date(NOW.getTime() - 10 * DAY),
        mileage: null,
        volume: null,
        fuelType: null,
        missedFillup: false,
      });
    }

    const { vehicles } = await repository.loadOptedIn(new Date(NOW.getTime() - 365 * DAY), NOW);
    const [loaded] = vehicles;
    expect(new Set(loaded?.expenses.map((e) => e.category))).toEqual(new Set(['fuel']));
    expect(loaded?.insurancePremiums).toEqual([
      {
        amount: 90_000,
        termStart: new Date(unix(-500) * 1000),
        termEnd: new Date(unix(-135) * 1000),
      },
    ]);
  });

  test('a failed run logs only the database cause, never the query or its ids', async () => {
    const failing = {
      ...RELEASE_DUE,
      loadOptedIn: () =>
        Promise.reject(
          new Error('Failed query: select ... params: owner-secret-id,vehicle-secret-id', {
            cause: Object.assign(new Error('database is locked'), { name: 'SQLiteError' }),
          })
        ),
    } as unknown as CommunityStatsRepository;
    const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
    try {
      await refreshSafely(failing);
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain('SQLiteError: database is locked');
      expect(logged).not.toContain('secret');
      expect(logged).not.toContain('select');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('a failure without a cause logs only the error name', async () => {
    const failing = {
      ...RELEASE_DUE,
      loadOptedIn: () => Promise.reject(new TypeError('owner-secret-id is not a thing')),
    } as unknown as CommunityStatsRepository;
    const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
    try {
      await refreshSafely(failing);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret');
      expect(JSON.stringify(errorSpy.mock.calls)).toContain('TypeError');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('every release records its time, even one that publishes nothing, and runs between releases do not', async () => {
    expect(await repository.lastRefreshedAt('local')).toBeNull();
    await refreshCommunityStats(repository, NOW);
    expect(db.sqlite.query('SELECT COUNT(*) AS n FROM community_stats').get()).toEqual({ n: 0 });
    expect(await repository.lastRefreshedAt('local')).toEqual(NOW);
    await refreshCommunityStats(repository, at(DAY));
    expect(await repository.lastRefreshedAt('local')).toEqual(NOW);
    await refreshCommunityStats(repository, at(PERIOD));
    expect(await repository.lastRefreshedAt('local')).toEqual(at(PERIOD));
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
