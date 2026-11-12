import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { ConflictError, handleDatabaseError, isUniqueConstraintError } from '../errors';

function sqliteError(sql: string): unknown {
  const db = new Database(':memory:');
  db.run('CREATE TABLE t (id TEXT PRIMARY KEY, email TEXT UNIQUE)');
  db.run("INSERT INTO t VALUES ('a', 'a@x')");
  db.run(
    "CREATE TRIGGER fake BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: by message only'); END"
  );
  try {
    db.run(sql);
  } catch (error) {
    return error;
  } finally {
    db.close();
  }
  throw new Error(`expected ${sql} to fail`);
}

describe('isUniqueConstraintError', () => {
  test('recognizes unique-index and primary-key violations by driver code', () => {
    expect(isUniqueConstraintError(sqliteError("INSERT INTO t VALUES ('b', 'a@x')"))).toBe(true);
    expect(isUniqueConstraintError(sqliteError("INSERT INTO t VALUES ('a', 'b@x')"))).toBe(true);
  });

  test('walks the cause chain of a wrapped driver error', () => {
    const wrapped = new Error('query failed', {
      cause: sqliteError("INSERT INTO t VALUES ('b', 'a@x')"),
    });
    expect(isUniqueConstraintError(wrapped)).toBe(true);
  });

  test('ignores an error whose message only mentions a unique violation', () => {
    expect(isUniqueConstraintError(sqliteError("UPDATE t SET email = 'z@x'"))).toBe(false);
    expect(isUniqueConstraintError(new Error('UNIQUE constraint failed: t.email'))).toBe(false);
  });
});

describe('handleDatabaseError', () => {
  test('maps a unique violation to a conflict', () => {
    expect(handleDatabaseError(sqliteError("INSERT INTO t VALUES ('b', 'a@x')"))).toBeInstanceOf(
      ConflictError
    );
  });
});
