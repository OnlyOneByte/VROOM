/**
 * Migration 0004: Relax next_due_date / due_date to nullable (cycle 22, T3).
 *
 * This is the high-risk rebuild deferred from T1. Relaxing the two NOT NULL date columns forces a
 * SQLite table rebuild of both `reminders` and `reminder_notifications`. The naive (drizzle-
 * generated) order drops `reminders` while the child tables (`reminder_vehicles`,
 * `reminder_notifications`) still hold rows — and because both children have ON DELETE CASCADE and
 * `PRAGMA foreign_keys=OFF` is a NO-OP inside the migrator's transaction, that DROP cascades and
 * silently wipes every child row (the C15 lesson). The hand-authored 0004 stashes children in
 * holding tables, empties the live children before the cascade-prone DROP, then refills them.
 *
 * These tests are the proof gate: they apply 0004 with foreign_keys ON inside the same BEGIN/COMMIT
 * the production migrator uses, and assert that an existing reminder + its junction row + its
 * notification ALL survive — the exact data loss the naive rebuild would cause.
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

describe('Migration 0004: nullable due dates + mileage dedup index', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    // foreign_keys ON reproduces production: this is what makes the cascade-on-DROP hazardous.
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  /** Seed a user + vehicle, then a reminder with a linked vehicle and a notification. */
  function seedReminderGraph(): void {
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    const vehicle = db.query('SELECT id FROM vehicles LIMIT 1').get() as { id: string };

    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES ('r1', ?, 'Oil change', 'notification', 'automatic', 'monthly', 'time', 0, 1000, 1)`,
      [user.id]
    );
    db.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('r1', ?)`, [
      vehicle.id,
    ]);
    db.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, is_read)
       VALUES ('n1', 'r1', ?, 1000, 0)`,
      [user.id]
    );
  }

  test('next_due_date and due_date become nullable', () => {
    applyMigrationsUpTo(db, migrations, 4);

    const reminderCols = db.query(`PRAGMA table_info('reminders')`).all() as {
      name: string;
      notnull: number;
    }[];
    const nextDueDate = reminderCols.find((c) => c.name === 'next_due_date');
    expect(nextDueDate?.notnull).toBe(0); // 0 = nullable

    const notifCols = db.query(`PRAGMA table_info('reminder_notifications')`).all() as {
      name: string;
      notnull: number;
    }[];
    const dueDate = notifCols.find((c) => c.name === 'due_date');
    expect(dueDate?.notnull).toBe(0);
  });

  test('the partial mileage dedup index exists', () => {
    applyMigrationsUpTo(db, migrations, 4);
    expect(getIndexNames(db, 'reminder_notifications')).toContain('rn_reminder_odo_idx');
    // The time-axis index must still be present too.
    expect(getIndexNames(db, 'reminder_notifications')).toContain('rn_reminder_due_idx');
  });

  test('existing reminder + junction row + notification ALL survive the rebuild', () => {
    // Seed at the pre-0004 state (migrations 0..3), then apply 0004.
    applyMigrationsUpTo(db, migrations, 3);
    seedReminderGraph();

    // Sanity: everything is present before the rebuild.
    expect(countRows(db, 'reminders')).toBe(1);
    expect(countRows(db, 'reminder_vehicles')).toBe(1);
    expect(countRows(db, 'reminder_notifications')).toBe(1);

    applyMigration(db, migrations[4]);

    // The whole reminder graph must survive — this is what the naive rebuild would have wiped.
    expect(countRows(db, 'reminders')).toBe(1);
    expect(countRows(db, 'reminder_vehicles')).toBe(1);
    expect(countRows(db, 'reminder_notifications')).toBe(1);

    // Row contents preserved (ids + values intact, not just counts).
    const r = db
      .query(`SELECT id, name, next_due_date, trigger_mode FROM reminders WHERE id = 'r1'`)
      .get() as { id: string; name: string; next_due_date: number; trigger_mode: string };
    expect(r.name).toBe('Oil change');
    expect(r.next_due_date).toBe(1000);
    expect(r.trigger_mode).toBe('time');

    const rv = db
      .query(`SELECT vehicle_id FROM reminder_vehicles WHERE reminder_id = 'r1'`)
      .get() as {
      vehicle_id: string;
    } | null;
    expect(rv).not.toBeNull();

    const n = db
      .query(`SELECT id, due_date, due_odometer FROM reminder_notifications WHERE id = 'n1'`)
      .get() as { id: string; due_date: number; due_odometer: number | null };
    expect(n.due_date).toBe(1000);
    expect(n.due_odometer).toBeNull();

    // No holding tables left behind.
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_hold_%'")
      .all() as { name: string }[];
    expect(tables.length).toBe(0);
  });

  test('a mileage-only reminder can now persist with a NULL next_due_date', () => {
    applyMigrationsUpTo(db, migrations, 4);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    const vehicle = db.query('SELECT id FROM vehicles LIMIT 1').get() as { id: string };

    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode, interval_mileage, last_service_odometer, next_due_odometer, start_date, next_due_date, is_active)
       VALUES ('r2', ?, 'Tire rotation', 'notification', 'automatic', 'custom', 'mileage', 5000, 30000, 35000, 0, NULL, 1)`,
      [user.id]
    );
    db.run(`INSERT INTO reminder_vehicles (reminder_id, vehicle_id) VALUES ('r2', ?)`, [
      vehicle.id,
    ]);
    // A mileage-fired notification: NULL due_date, milestone in due_odometer.
    db.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
       VALUES ('n2', 'r2', ?, NULL, 35000, 0)`,
      [user.id]
    );

    const r = db.query(`SELECT next_due_date FROM reminders WHERE id = 'r2'`).get() as {
      next_due_date: number | null;
    };
    expect(r.next_due_date).toBeNull();
    const n = db
      .query(`SELECT due_date, due_odometer FROM reminder_notifications WHERE id = 'n2'`)
      .get() as {
      due_date: number | null;
      due_odometer: number;
    };
    expect(n.due_date).toBeNull();
    expect(n.due_odometer).toBe(35000);
  });

  test('the partial mileage index dedups on (reminderId, dueOdometer) but leaves the time axis free', () => {
    applyMigrationsUpTo(db, migrations, 4);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES ('r3', ?, 'Both', 'notification', 'automatic', 'monthly', 'both', 0, 1000, 1)`,
      [user.id]
    );

    // Two mileage notifications at the same odometer milestone must collide on the partial index.
    db.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
       VALUES ('m1', 'r3', ?, NULL, 35000, 0)`,
      [user.id]
    );
    expect(() =>
      db.run(
        `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
         VALUES ('m2', 'r3', ?, NULL, 35000, 0)`,
        [user.id]
      )
    ).toThrow();

    // But two time notifications (NULL due_odometer) at DIFFERENT periods do NOT collide on the
    // mileage index — proving the partial WHERE keeps the axes independent.
    db.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
       VALUES ('t1', 'r3', ?, 2000, NULL, 0)`,
      [user.id]
    );
    db.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read)
       VALUES ('t2', 'r3', ?, 3000, NULL, 0)`,
      [user.id]
    );
    expect(countRows(db, 'reminder_notifications')).toBe(3); // m1, t1, t2
  });
});
