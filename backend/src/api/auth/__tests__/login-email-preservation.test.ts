/**
 * Login must not overwrite users.email with the provider's current email. The email is only
 * backfilled when empty; displayName always syncs. The handler is private, so this checks the
 * decision against an in-memory users table and also scans routes.ts for the gate.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';

// Mirrors updateExistingUserProfile. users.email is NOT NULL, so "unset" is the empty string.
function applyLoginProfileSync(
  db: Database,
  userId: string,
  providerEmail: string,
  providerDisplayName: string
): void {
  const current = db.query('SELECT email FROM users WHERE id = ? LIMIT 1').get(userId) as {
    email: string;
  } | null;
  const shouldBackfillEmail = !current?.email;
  if (shouldBackfillEmail) {
    db.run('UPDATE users SET email = ?, display_name = ? WHERE id = ?', [
      providerEmail,
      providerDisplayName,
      userId,
    ]);
  } else {
    db.run('UPDATE users SET display_name = ? WHERE id = ?', [providerDisplayName, userId]);
  }
}

describe('login email preservation — behavioral model', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    for (const m of loadMigrations()) applyMigration(db, m);
  });
  afterEach(() => db.close());

  test('an existing non-empty login email is preserved across a re-login with a different provider email', () => {
    db.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'google_1',
      'original@example.com',
      'Original Name',
    ]);
    applyLoginProfileSync(db, 'google_1', 'changed@gmail.com', 'Updated Name');
    const row = db.query('SELECT email, display_name FROM users WHERE id = ?').get('google_1') as {
      email: string;
      display_name: string;
    };
    expect(row.email).toBe('original@example.com');
    expect(row.display_name).toBe('Updated Name');
  });

  test('an empty stored email is backfilled from the provider', () => {
    db.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'google_2',
      '',
      'No Email Yet',
    ]);
    applyLoginProfileSync(db, 'google_2', 'backfilled@gmail.com', 'No Email Yet');
    const row = db.query('SELECT email FROM users WHERE id = ?').get('google_2') as {
      email: string;
    };
    expect(row.email).toBe('backfilled@gmail.com');
  });
});

describe('login email preservation — source scan', () => {
  test('updateExistingUserProfile gates the email write on the stored email being empty', async () => {
    const src = await Bun.file(`${import.meta.dir}/../routes.ts`).text();
    const start = src.indexOf('async function updateExistingUserProfile');
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const nextFn = rest.search(/\n(async function |function )/);
    const body = nextFn === -1 ? rest : rest.slice(0, nextFn);

    expect(body).toContain('.select({ email: users.email })');
    expect(body).toMatch(/shouldBackfillEmail\s*=\s*!current\?\.email/);
    expect(body).toContain('.set({ displayName: userInfo.displayName, updatedAt: new Date() })');
    const gateIdx = body.indexOf('shouldBackfillEmail');
    const emailWriteIdx = body.indexOf('.set({ email: userInfo.email');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(emailWriteIdx).toBeGreaterThan(gateIdx);
  });
});
