/**
 * Migration 0005: license-plate uniqueness becomes PER-USER.
 *
 * Swaps the global partial-unique index on `vehicles(license_plate)` for a partial-unique index on
 * `vehicles(user_id, license_plate)`. Index swaps are invisible to a column/table assertion, so this
 * test pins the behaviour on both sides of the swap:
 *  - BEFORE: a second user registering a plate another user already holds is rejected (which both
 *    blocked legitimate reissued/resold plates and leaked plate existence across tenants).
 *  - AFTER: two users may each hold the same plate string; one user still may not hold it twice.
 *  - plate-less vehicles are excluded by the WHERE clause, so a user may own many of them.
 *  - the swap is index-only: existing rows survive, and no table rebuild scaffolding is left behind.
 *
 * The swap can never fail on existing data: global uniqueness implies per-user uniqueness, so any
 * database that satisfied the old index also satisfies the new one.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getIndexNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0005: per-user license-plate uniqueness', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  /** seedCoreData makes u1 + vehicle v1; add a second tenant to contend over a plate. */
  function seedTwoUsers(): void {
    seedCoreData(db);
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'other@example.com', 'Other')"
    );
  }

  function insertVehicle(id: string, userId: string, plate: string | null): void {
    db.run(
      'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, 'Honda', 'Civic', 2020, plate]
    );
  }

  test('the global plate index is replaced by the per-user one', () => {
    applyMigrationsUpTo(db, migrations, 5);
    const indexes = getIndexNames(db, 'vehicles');
    expect(indexes).toContain('vehicles_user_license_plate_idx');
    expect(indexes).not.toContain('vehicles_license_plate_idx');
  });

  test('the new index is UNIQUE, PARTIAL, and keyed on (user_id, license_plate)', () => {
    applyMigrationsUpTo(db, migrations, 5);

    const meta = (
      db.query("PRAGMA index_list('vehicles')").all() as {
        name: string;
        unique: number;
        partial: number;
      }[]
    ).find((i) => i.name === 'vehicles_user_license_plate_idx');
    expect(meta?.unique).toBe(1);
    expect(meta?.partial).toBe(1); // WHERE license_plate IS NOT NULL

    const columns = (
      db.query("PRAGMA index_info('vehicles_user_license_plate_idx')").all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toEqual(['user_id', 'license_plate']);
  });

  test('BEFORE 0005 the plate is globally unique — a second user is wrongly rejected', () => {
    applyMigrationsUpTo(db, migrations, 4);
    seedTwoUsers();
    db.run("UPDATE vehicles SET license_plate = 'ABC123' WHERE id = 'v1'"); // u1 holds the plate
    expect(() => insertVehicle('v2', 'u2', 'ABC123')).toThrow();
  });

  test('AFTER 0005 two users may hold the same plate', () => {
    applyMigrationsUpTo(db, migrations, 5);
    seedTwoUsers();
    db.run("UPDATE vehicles SET license_plate = 'ABC123' WHERE id = 'v1'");
    expect(() => insertVehicle('v2', 'u2', 'ABC123')).not.toThrow();
    expect(countRows(db, 'vehicles')).toBe(2);
  });

  test('AFTER 0005 one user may NOT hold the same plate twice', () => {
    applyMigrationsUpTo(db, migrations, 5);
    seedTwoUsers();
    db.run("UPDATE vehicles SET license_plate = 'ABC123' WHERE id = 'v1'");
    expect(() => insertVehicle('v2', 'u1', 'ABC123')).toThrow();
    expect(countRows(db, 'vehicles')).toBe(1);
  });

  test('plate-less vehicles are outside the index — one user may own several', () => {
    applyMigrationsUpTo(db, migrations, 5);
    seedTwoUsers();
    expect(() => insertVehicle('v2', 'u1', null)).not.toThrow();
    expect(() => insertVehicle('v3', 'u1', null)).not.toThrow();
    expect(countRows(db, 'vehicles')).toBe(3);
  });

  test('the swap is index-only — existing rows survive and no rebuild scaffolding is left', () => {
    applyMigrationsUpTo(db, migrations, 4);
    seedTwoUsers();
    db.run("UPDATE vehicles SET license_plate = 'ABC123' WHERE id = 'v1'");
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[5]);

    expect(countRows(db, 'users')).toBe(2);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
    const plate = db.query("SELECT license_plate FROM vehicles WHERE id = 'v1'").get() as {
      license_plate: string;
    };
    expect(plate.license_plate).toBe('ABC123');

    const scaffold = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'")
      .all() as { name: string }[];
    expect(scaffold.length).toBe(0);
  });
});
