/**
 * Migration 0010: vehicle_shares (vehicle-sharing T1; Angelo ratified D1-D8 2026-06-27).
 *
 * Purely ADDITIVE — a single CREATE TABLE + three indexes, the 0003/0007 additive class (no backfill,
 * no table rebuild). This test is the proof gate that 0010 is additive AND that the share constraints
 * hold:
 *   - the table + its three indexes exist after the migration,
 *   - all three FKs (vehicle, owner, invitee) cascade-delete the share row (D8),
 *   - the partial-unique active-share index rejects a SECOND pending/accepted share for the same
 *     (vehicle, invitee) but ALLOWS re-inviting after the prior share is declined/revoked (design §1),
 *   - 0010 did NOT rebuild/drop any existing table (the C15 / migration-0004 cascade-wipe footgun:
 *     drizzle-kit tried to bundle 6 table rebuilds off a stale 0009 snapshot; T1 stripped them, and
 *     this test pins that the existing data survives applying 0010).
 *
 * foreign_keys = ON reproduces production (what makes a stray DROP cascade-hazardous).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getIndexNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0010: vehicle_shares (additive share table)', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  /** Seed a second user to act as the invitee (seedCoreData makes u1 + vehicle v1). */
  function seedOwnerInviteeVehicle(): void {
    seedCoreData(db);
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'invitee@example.com', 'Invitee')"
    );
  }

  function insertShare(id: string, status: string, sharedWith = 'u2'): void {
    db.run(
      `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, created_at, updated_at)
       VALUES (?, 'v1', 'u1', ?, 'viewer', ?, 0, 0)`,
      [id, sharedWith, status]
    );
  }

  test('the table and its three indexes exist', () => {
    applyMigrationsUpTo(db, migrations, 10);
    expect(getTables(db)).toContain('vehicle_shares');
    const idx = getIndexNames(db, 'vehicle_shares');
    expect(idx).toContain('vehicle_shares_active_idx');
    expect(idx).toContain('vehicle_shares_shared_with_idx');
    expect(idx).toContain('vehicle_shares_owner_idx');
  });

  test('an active share can be created and read back', () => {
    applyMigrationsUpTo(db, migrations, 10);
    seedOwnerInviteeVehicle();
    insertShare('s1', 'pending');
    expect(countRows(db, 'vehicle_shares')).toBe(1);
    const row = db
      .query(
        `SELECT vehicle_id, owner_id, shared_with_id, level, status FROM vehicle_shares WHERE id = 's1'`
      )
      .get() as Record<string, string>;
    expect(row.vehicle_id).toBe('v1');
    expect(row.owner_id).toBe('u1');
    expect(row.shared_with_id).toBe('u2');
    expect(row.level).toBe('viewer');
    expect(row.status).toBe('pending');
  });

  test('the partial-unique active index rejects a second pending/accepted share for the same (vehicle, invitee)', () => {
    applyMigrationsUpTo(db, migrations, 10);
    seedOwnerInviteeVehicle();
    insertShare('s1', 'pending');
    // A second ACTIVE (pending) share for the same (v1, u2) collides on the partial-unique index.
    expect(() => insertShare('s2', 'pending')).toThrow();
    // An accepted one likewise collides (both 'pending' and 'accepted' are "active").
    expect(() => insertShare('s3', 'accepted')).toThrow();
  });

  test('a declined/revoked share does NOT block re-inviting the same user to the same vehicle', () => {
    applyMigrationsUpTo(db, migrations, 10);
    seedOwnerInviteeVehicle();
    insertShare('s1', 'declined');
    insertShare('s2', 'revoked');
    // Neither inactive row is in the partial index, so a fresh active invite is allowed.
    expect(() => insertShare('s3', 'pending')).not.toThrow();
    expect(countRows(db, 'vehicle_shares')).toBe(3);
  });

  test('deleting the vehicle cascade-deletes its shares (D8)', () => {
    applyMigrationsUpTo(db, migrations, 10);
    seedOwnerInviteeVehicle();
    insertShare('s1', 'accepted');
    db.run("DELETE FROM vehicles WHERE id = 'v1'");
    expect(countRows(db, 'vehicle_shares')).toBe(0);
  });

  test('deleting the invitee cascade-deletes shares to them; the owner vehicle survives', () => {
    applyMigrationsUpTo(db, migrations, 10);
    seedOwnerInviteeVehicle();
    insertShare('s1', 'accepted');
    db.run("DELETE FROM users WHERE id = 'u2'");
    expect(countRows(db, 'vehicle_shares')).toBe(0);
    expect(countRows(db, 'vehicles')).toBe(1); // owner's vehicle is untouched
  });

  test('0010 is additive — applying it preserves existing user/vehicle/expense rows (no table rebuild)', () => {
    // Seed at the pre-0010 state (0..9), then apply 0010 and assert the core graph survived.
    applyMigrationsUpTo(db, migrations, 9);
    seedCoreData(db); // u1 + v1 + e1
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[10]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
    // No leftover drizzle rebuild scaffolding (the __new_* holding tables a bundled rebuild would leave).
    const scaffold = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'")
      .all() as { name: string }[];
    expect(scaffold.length).toBe(0);
  });
});
