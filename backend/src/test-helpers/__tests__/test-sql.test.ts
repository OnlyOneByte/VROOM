import { describe, expect, test } from 'bun:test';
import { useTestApp } from '../http-client';
import { positionalPlaceholders } from '../test-sql';

describe('positionalPlaceholders', () => {
  test('numbers each placeholder in order', () => {
    expect(positionalPlaceholders('SELECT * FROM t WHERE a = ? AND b IN (?, ?)')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)'
    );
  });

  test('leaves question marks in strings, identifiers and comments alone', () => {
    const text = `SELECT 'why?', "odd?name" FROM t -- really?\n WHERE a = ? /* ok? */ AND b = 'it''s?'`;
    expect(positionalPlaceholders(text)).toBe(
      `SELECT 'why?', "odd?name" FROM t -- really?\n WHERE a = $1 /* ok? */ AND b = 'it''s?'`
    );
  });
});

describe('ctx.sql', () => {
  const ctx = useTestApp({ id: 'sql-owner' });

  test('writes and reads rows on the active database', async () => {
    const { sql } = ctx();
    await sql.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
      'sql-v1',
      'sql-owner',
      'Honda',
      'Civic',
      2021,
    ]);
    expect(await sql.get('SELECT make FROM vehicles WHERE id = ?', ['sql-v1'])).toEqual({
      make: 'Honda',
    });
    expect(await sql.get('SELECT make FROM vehicles WHERE id = ?', ['missing'])).toBeNull();
    expect(
      await sql.all<{ n: number }>('SELECT COUNT(*) AS n FROM vehicles WHERE user_id = ?', [
        'sql-owner',
      ])
    ).toEqual([{ n: 1 }]);
  });
});
