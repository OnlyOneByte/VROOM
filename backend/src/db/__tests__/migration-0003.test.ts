/**
 * Migration 0003: Maintenance-schedule columns (cycle 15, T1 — additive only)
 *
 * Pure `ALTER TABLE ADD COLUMN` (no table rebuild, so existing rows are untouched):
 * - reminders gains trigger_mode (default 'time'), interval_mileage, last_service_odometer,
 *   next_due_odometer.
 * - reminder_notifications gains due_odometer.
 *
 * Relaxing next_due_date / due_date to nullable + widening the dedup index is deferred to T3
 * (it forces a table rebuild, which under the test harness's transaction cascades child rows;
 * keeping T1 additive avoids that risk entirely).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0003: maintenance-schedule columns (additive)', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('reminders gains the maintenance columns', () => {
    applyMigrationsUpTo(db, migrations, 3);
    const cols = getColumnNames(db, 'reminders');
    for (const c of [
      'trigger_mode',
      'interval_mileage',
      'last_service_odometer',
      'next_due_odometer',
    ]) {
      expect(cols).toContain(c);
    }
  });

  test('reminder_notifications gains due_odometer', () => {
    applyMigrationsUpTo(db, migrations, 3);
    expect(getColumnNames(db, 'reminder_notifications')).toContain('due_odometer');
  });

  test('an existing reminder + notification survive the additive migration with new defaults', () => {
    // Seed BEFORE 0003 (state as of migration 0002), then apply 0003 and confirm survival.
    applyMigrationsUpTo(db, migrations, 2);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };

    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, start_date, next_due_date, is_active)
       VALUES ('r1', ?, 'Oil reminder', 'notification', 'automatic', 'monthly', 0, 1000, 1)`,
      [user.id]
    );
    db.run(
      `INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, is_read)
       VALUES ('n1', 'r1', ?, 1000, 0)`,
      [user.id]
    );

    applyMigration(db, migrations[3]);

    // ADD COLUMN preserves every row.
    expect(countRows(db, 'reminders')).toBe(1);
    expect(countRows(db, 'reminder_notifications')).toBe(1);

    // The existing reminder picked up trigger_mode='time' (the additive default) + null odometers.
    const r = db
      .query(
        `SELECT trigger_mode, interval_mileage, next_due_odometer, next_due_date FROM reminders WHERE id = 'r1'`
      )
      .get() as {
      trigger_mode: string;
      interval_mileage: number | null;
      next_due_odometer: number | null;
      next_due_date: number;
    };
    expect(r.trigger_mode).toBe('time');
    expect(r.interval_mileage).toBeNull();
    expect(r.next_due_odometer).toBeNull();
    expect(r.next_due_date).toBe(1000);

    const n = db.query(`SELECT due_odometer FROM reminder_notifications WHERE id = 'n1'`).get() as {
      due_odometer: number | null;
    };
    expect(n.due_odometer).toBeNull();
  });

  test('a mileage reminder can store its interval + odometer anchor', () => {
    applyMigrationsUpTo(db, migrations, 3);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    // Mileage/both still carries a next_due_date here (NOT NULL until T3); the mileage axis is
    // exercised via the new columns.
    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode, interval_mileage, last_service_odometer, next_due_odometer, start_date, next_due_date, is_active)
       VALUES ('r2', ?, 'Oil change', 'notification', 'automatic', 'custom', 'mileage', 5000, 30000, 35000, 0, 0, 1)`,
      [user.id]
    );
    const r = db
      .query(
        `SELECT trigger_mode, interval_mileage, last_service_odometer, next_due_odometer FROM reminders WHERE id = 'r2'`
      )
      .get() as {
      trigger_mode: string;
      interval_mileage: number;
      last_service_odometer: number;
      next_due_odometer: number;
    };
    expect(r.trigger_mode).toBe('mileage');
    expect(r.interval_mileage).toBe(5000);
    expect(r.last_service_odometer).toBe(30000);
    expect(r.next_due_odometer).toBe(35000);
  });
});
