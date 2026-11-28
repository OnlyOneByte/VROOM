import { beforeEach, describe, expect, test } from 'bun:test';
import { failWrites } from '../fail-writes';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);

const insertCar = (id: string) =>
  ctx.sql.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'M', 'X', 2020)",
    [id, ctx.user.id]
  );

describe('failWrites', () => {
  test('fails matching writes with the exact message until restored', async () => {
    const restore = await failWrites(ctx.sql, {
      name: 'fail_writes_check',
      table: 'vehicles',
      event: 'INSERT',
      message: "100% blocked, isn't it",
      when: "NEW.id <> 'allowed'",
    });
    try {
      await expect(insertCar('blocked')).rejects.toThrow("100% blocked, isn't it");
      await insertCar('allowed');
    } finally {
      await restore();
    }
    await insertCar('blocked');
    expect(await ctx.sql.all('SELECT id FROM vehicles ORDER BY id')).toEqual([
      { id: 'allowed' },
      { id: 'blocked' },
    ]);
  });

  test('the same rule can be set up again after a restore', async () => {
    const rule = { name: 'fail_writes_again', table: 'vehicles', event: 'INSERT', message: 'no' };
    await (await failWrites(ctx.sql, rule))();
    const restore = await failWrites(ctx.sql, rule);
    try {
      await expect(insertCar('again')).rejects.toThrow('no');
    } finally {
      await restore();
    }
  });
});
