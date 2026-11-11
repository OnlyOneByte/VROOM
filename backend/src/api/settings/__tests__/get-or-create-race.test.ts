/**
 * `getOrCreate` on a row that does not exist yet must be idempotent under concurrency.
 *
 * user_preferences and sync_state are both PK'd by userId and both rows are created lazily on first
 * use. A brand-new account's first session routinely issues several requests that touch preferences
 * before any of them has committed (two tabs, a reload mid-load, the activity middleware's own
 * getOrCreate overlapping a settings fetch). With a plain select-then-insert every one of those
 * requests misses the select and tries to insert; the losers raise
 * SQLITE_CONSTRAINT_PRIMARYKEY, which the repository wraps into a 500 — a brand-new user's very
 * first page load, half-failed.
 *
 * The invariant pinned here: concurrent first-time getOrCreate calls all return THE SAME single row,
 * and the endpoints that create it concurrently all succeed.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules — keep static imports to the
 * harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function rowCount(table: 'user_preferences' | 'sync_state'): number {
  const row = ctx.sqlite
    .query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
    .get(ctx.user.id) as { n: number };
  return row.n;
}

describe('lazy row creation under concurrency', () => {
  test('three concurrent first-time GET /settings all succeed', async () => {
    expect(rowCount('user_preferences')).toBe(0); // the brand-new-account precondition

    const responses = await Promise.all([
      ctx.authed('GET', '/api/v1/settings'),
      ctx.authed('GET', '/api/v1/settings'),
      ctx.authed('GET', '/api/v1/settings'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(rowCount('user_preferences')).toBe(1);
  });

  test('concurrent preferencesRepository.getOrCreate returns one shared row', async () => {
    // Import through the SAME dynamic-import path the app uses so this binds to the test DB.
    const { preferencesRepository } = await import('../repository');

    const rows = await Promise.all([
      preferencesRepository.getOrCreate(ctx.user.id),
      preferencesRepository.getOrCreate(ctx.user.id),
      preferencesRepository.getOrCreate(ctx.user.id),
    ]);

    expect(rowCount('user_preferences')).toBe(1);
    for (const row of rows) {
      expect(row.userId).toBe(ctx.user.id);
      expect(row.currencyUnit).toBe('USD');
    }
  });

  test('concurrent syncStateRepository.getOrCreate returns one shared row', async () => {
    const { syncStateRepository } = await import('../repository');

    const rows = await Promise.all([
      syncStateRepository.getOrCreate(ctx.user.id),
      syncStateRepository.getOrCreate(ctx.user.id),
      syncStateRepository.getOrCreate(ctx.user.id),
    ]);

    expect(rowCount('sync_state')).toBe(1);
    for (const row of rows) {
      expect(row.userId).toBe(ctx.user.id);
    }
  });

  test('concurrent first-time markDataChanged stamps the sync-state row without erroring', async () => {
    const { syncStateRepository } = await import('../repository');

    await Promise.all([
      syncStateRepository.markDataChanged(ctx.user.id),
      syncStateRepository.markDataChanged(ctx.user.id),
    ]);

    expect(rowCount('sync_state')).toBe(1);
    const state = await syncStateRepository.getOrCreate(ctx.user.id);
    expect(state.lastDataChangeDate).not.toBeNull();
  });
});
