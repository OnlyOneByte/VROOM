import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { transaction } from '../db/connection';
import {
  ConflictError,
  DatabaseError,
  handleDatabaseError,
  isSqliteError,
  isUniqueConstraintError,
  NotFoundError,
} from '../errors';

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

describe('isSqliteError', () => {
  test('recognizes a driver error by code, including through a cause chain', () => {
    const driverError = sqliteError("INSERT INTO t VALUES ('b', 'a@x')");
    expect(isSqliteError(driverError)).toBe(true);
    expect(isSqliteError(new Error('wrapped', { cause: driverError }))).toBe(true);
    expect(isSqliteError(new Error('plain failure'))).toBe(false);
  });
});

describe('transaction', () => {
  test('a driver failure surfaces as a generic error without the driver text', async () => {
    const driverError = sqliteError("INSERT INTO t VALUES ('b', 'a@x')");
    const failing = transaction(() => {
      throw driverError;
    });
    await expect(failing).rejects.toBeInstanceOf(ConflictError);
    const thrown = await failing.catch((e: unknown) => e as Error);
    expect(thrown.message).not.toContain('UNIQUE');
    expect((thrown as ConflictError).details).toBeUndefined();
  });

  test('a non-unique driver failure becomes a generic DatabaseError', async () => {
    const failing = transaction(() => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' });
    });
    const thrown = await failing.catch((e: unknown) => e as Error);
    expect(thrown).toBeInstanceOf(DatabaseError);
    expect(thrown.message).toBe('A database error occurred');
  });

  test('an application error thrown inside passes through unchanged', async () => {
    const failing = transaction(() => {
      throw new NotFoundError('Vehicle');
    });
    await expect(failing).rejects.toBeInstanceOf(NotFoundError);
  });
});
