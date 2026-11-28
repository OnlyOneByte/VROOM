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

  test('keeps numbered placeholders and continues after the highest one', () => {
    expect(positionalPlaceholders('SELECT ?2, ?1, ?, ?')).toBe('SELECT $2, $1, $3, $4');
  });

  test('leaves dollar-quoted and escape strings alone', () => {
    const text = String.raw`SELECT $$why?$$, $q$a?b$q$, E'it\'s?' WHERE a = ?`;
    expect(positionalPlaceholders(text)).toBe(
      String.raw`SELECT $$why?$$, $q$a?b$q$, E'it\'s?' WHERE a = $1`
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
    expect(
      await sql.get('SELECT SUM(year) AS total FROM vehicles WHERE user_id = ?', ['sql-owner'])
    ).toEqual({ total: 2021 });
  });
});
