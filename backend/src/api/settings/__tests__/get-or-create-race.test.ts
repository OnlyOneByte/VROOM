/**
 * Concurrent first-time getOrCreate calls for user_preferences and sync_state must all return the
 * same single row instead of failing on the primary key.
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
    expect(rowCount('user_preferences')).toBe(0);

    const responses = await Promise.all([
      ctx.authed('GET', '/api/v1/settings'),
      ctx.authed('GET', '/api/v1/settings'),
      ctx.authed('GET', '/api/v1/settings'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(rowCount('user_preferences')).toBe(1);
  });

  test('concurrent preferencesRepository.getOrCreate returns one shared row', async () => {
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
