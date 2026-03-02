/**
 * Migration 0000: Initial schema
 *
 * Creates users, vehicles, expenses, vehicle_financing,
 * insurance_policies, user_settings, and sessions tables.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  getColumnNames,
  getIndexNames,
  getTables,
  loadMigrations,
} from './migration-helpers';

describe('Migration 0000: Initial Schema', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates all core tables', () => {
    applyMigration(db, migrations[0]);

    const tables = getTables(db);
    expect(tables).toContain('users');
    expect(tables).toContain('vehicles');
    expect(tables).toContain('expenses');
    expect(tables).toContain('vehicle_financing');
    expect(tables).toContain('insurance_policies');
    expect(tables).toContain('user_settings');
    expect(tables).toContain('sessions');
  });

  test('vehicles table has expected columns', () => {
    applyMigration(db, migrations[0]);

    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('make');
    expect(cols).toContain('model');
    expect(cols).toContain('year');
    expect(cols).toContain('vehicle_type');
  });

  test('users.email has a unique index', () => {
    applyMigration(db, migrations[0]);

    const indexes = getIndexNames(db, 'users');
    expect(indexes.some((n) => n.includes('email'))).toBe(true);
  });

  test('user_settings.user_id has a unique index', () => {
    applyMigration(db, migrations[0]);

    const indexes = getIndexNames(db, 'user_settings');
    expect(indexes.some((n) => n.includes('user_id'))).toBe(true);
  });
});
