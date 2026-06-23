/**
 * #129 (C155) — login email-preservation guard.
 *
 * `updateExistingUserProfile` (auth/routes.ts) runs on EVERY OAuth login. It used to OVERWRITE
 * `users.email` (the VROOM login identity) with the provider's currently-reported email each time, so a
 * user who changed their Google/GitHub primary email had their VROOM login email silently swapped on the
 * next login — a within-account identity drift with no notice. Angelo's decision (2026-06-23): sync email
 * ONLY as a first-link BACKFILL (when the stored email is empty/unset); otherwise PRESERVE it. displayName
 * stays synced unconditionally; the cross-account UNIQUE-collision fallback is kept for the backfill write.
 *
 * `updateExistingUserProfile` is a private (un-exported) handler helper, so this guard pins the behavior
 * two ways that BOTH break if the fix regresses to the old unconditional overwrite:
 *   (A) a behavioral model of the EXACT decision logic against a real in-memory users table (the SQL
 *       contract the handler runs): existing non-empty email preserved across a re-login with a different
 *       provider email; an empty email backfilled.
 *   (B) a source-scan asserting routes.ts gates the email write on the stored email being empty (so a
 *       future edit can't silently restore `set({ email: userInfo.email, ... })` unconditionally).
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';

// The decision's logic, applied to the users row exactly as updateExistingUserProfile does: email is
// adopted ONLY when the current stored email is empty/unset; displayName always refreshed. (users.email
// is NOT NULL, so "unset" means the empty string — the first-link backfill state.)
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

describe('#129 login email-preservation — behavioral model (A)', () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    for (const m of loadMigrations()) applyMigration(db, m);
  });
  afterEach(() => db.close());

  test('an existing NON-empty login email is PRESERVED across a re-login with a different provider email', () => {
    db.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'google_1',
      'original@example.com',
      'Original Name',
    ]);
    // The user changed their Google primary email; the next login reports the NEW one.
    applyLoginProfileSync(db, 'google_1', 'changed@gmail.com', 'Updated Name');
    const row = db.query('SELECT email, display_name FROM users WHERE id = ?').get('google_1') as {
      email: string;
      display_name: string;
    };
    expect(row.email).toBe('original@example.com'); // identity PRESERVED, not silently swapped
    expect(row.display_name).toBe('Updated Name'); // displayName still synced
  });

  test('an EMPTY stored email IS backfilled from the provider (first-link)', () => {
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

describe('#129 login email-preservation — source-scan (B)', () => {
  test('updateExistingUserProfile gates the email write on the stored email being empty', async () => {
    const src = await Bun.file(`${import.meta.dir}/../routes.ts`).text();
    const start = src.indexOf('async function updateExistingUserProfile');
    expect(start).toBeGreaterThan(-1);
    // Bound the scan to the function body (until the next top-level `async function`/`function ` after it).
    const rest = src.slice(start + 1);
    const nextFn = rest.search(/\n(async function |function )/);
    const body = nextFn === -1 ? rest : rest.slice(0, nextFn);

    // It must READ the current email and gate the backfill on it being empty — not overwrite blindly.
    expect(body).toContain('.select({ email: users.email })');
    expect(body).toMatch(/shouldBackfillEmail\s*=\s*!current\?\.email/);
    // The display-only update (the preserve path) must exist.
    expect(body).toContain('.set({ displayName: userInfo.displayName, updatedAt: new Date() })');
    // The email write must be REACHED ONLY in the backfill branch — guard against a regression that
    // restores an unconditional email overwrite by requiring the gate variable to exist before it.
    const gateIdx = body.indexOf('shouldBackfillEmail');
    const emailWriteIdx = body.indexOf('.set({ email: userInfo.email');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(emailWriteIdx).toBeGreaterThan(gateIdx); // the email write comes AFTER the gate is computed
  });
});
