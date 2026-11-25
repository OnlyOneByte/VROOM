import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
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
    expect(rowCount('user_preferences')).toBe(0);

    const responses = await Promise.all([
      ctx.authed('GET', '/api/v1/settings'),
      ctx.authed('GET', '/api/v1/settings'),
      ctx.authed('GET', '/api/v1/settings'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(rowCount('user_preferences')).toBe(1);
  });

  test('concurrent repos().preferences.getOrCreate returns one shared row', async () => {
    const rows = await Promise.all([
      repos().preferences.getOrCreate(ctx.user.id),
      repos().preferences.getOrCreate(ctx.user.id),
      repos().preferences.getOrCreate(ctx.user.id),
    ]);

    expect(rowCount('user_preferences')).toBe(1);
    for (const row of rows) {
      expect(row.userId).toBe(ctx.user.id);
      expect(row.currencyUnit).toBe('USD');
    }
  });

  test('concurrent repos().syncState.getOrCreate returns one shared row', async () => {
    const rows = await Promise.all([
      repos().syncState.getOrCreate(ctx.user.id),
      repos().syncState.getOrCreate(ctx.user.id),
      repos().syncState.getOrCreate(ctx.user.id),
    ]);

    expect(rowCount('sync_state')).toBe(1);
    for (const row of rows) {
      expect(row.userId).toBe(ctx.user.id);
    }
  });

  test('concurrent first-time markDataChanged stamps the sync-state row without erroring', async () => {
    await Promise.all([
      repos().syncState.markDataChanged(ctx.user.id),
      repos().syncState.markDataChanged(ctx.user.id),
    ]);

    expect(rowCount('sync_state')).toBe(1);
    const state = await repos().syncState.getOrCreate(ctx.user.id);
    expect(state.lastDataChangeDate).not.toBeNull();
  });
});
