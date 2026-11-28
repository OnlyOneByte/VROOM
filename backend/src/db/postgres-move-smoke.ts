import { Database } from 'bun:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { builtInRoleId } from '../permissions/grants';

export const MOVE_ORIGIN = 'http://127.0.0.1:4173';
const DAY_SECONDS = 86_400;

function newId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function sqliteSession(path: string): string {
  const db = new Database(path);
  const user = db.query('SELECT id FROM users ORDER BY created_at, id LIMIT 1').get() as {
    id: string;
  } | null;
  if (!user) throw new Error(`No account in ${path}; run bun run db:seed first`);
  const session = newId();
  db.query('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    session,
    user.id,
    Math.floor(Date.now() / 1000) + DAY_SECONDS
  );
  db.close();
  return session;
}

export async function postgresSession(url: string): Promise<string> {
  const sql = new Bun.SQL(url, { max: 1 });
  const userId = newId();
  const session = newId();
  const now = Math.floor(Date.now() / 1000);
  try {
    await sql`INSERT INTO users (id, email, display_name, created_at, updated_at)
      VALUES (${userId}, ${`move-${userId}@vroom.test`}, 'Moved account', ${now}, ${now})`;
    await sql`INSERT INTO role_assignments (id, user_id, role_id, scope_id, created_at)
      VALUES (${newId()}, ${userId}, ${builtInRoleId('member')}, NULL, ${now})`;
    await sql`INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${session}, ${userId}, ${now + DAY_SECONDS})`;
  } finally {
    await sql.close();
  }
  return session;
}

function headers(session: string): Record<string, string> {
  return { Cookie: `auth_session=${session}`, Origin: MOVE_ORIGIN };
}

export async function exportBackup(base: string, session: string, out: string): Promise<void> {
  const res = await fetch(`${base}/api/v1/sync/backups/download`, { headers: headers(session) });
  if (!res.ok) throw new Error(`Backup download failed: ${res.status} ${await res.text()}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

export async function restoreBackup(base: string, session: string, zip: string): Promise<void> {
  const form = new FormData();
  form.set('file', new File([readFileSync(zip)], 'backup.zip', { type: 'application/zip' }));
  form.set('mode', 'replace');
  const res = await fetch(`${base}/api/v1/sync/restore/from-backup`, {
    method: 'POST',
    headers: { ...headers(session), 'Idempotency-Key': newId() },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Restore failed: ${res.status} ${body}`);
  console.log(`Restore: ${body}`);
}

export function rowCounts(zipPath: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of new AdmZip(zipPath).getEntries()) {
    if (!entry.entryName.endsWith('.csv')) continue;
    const rows = parse(entry.getData().toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
    });
    counts[entry.entryName] = rows.length;
  }
  return counts;
}

export function compareBackups(before: string, after: string): string[] {
  const a = rowCounts(before);
  const b = rowCounts(after);
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const differences = names
    .filter((name) => a[name] !== b[name])
    .map(
      (name) => `${name}: ${a[name] ?? 'missing'} on SQLite, ${b[name] ?? 'missing'} on Postgres`
    );
  if (Object.values(a).reduce((sum, n) => sum + n, 0) === 0) {
    differences.push('The SQLite backup has no rows, so nothing was moved');
  }
  for (const name of names) console.log(`${name}: ${a[name] ?? 0} -> ${b[name] ?? 0}`);
  return differences;
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const need = (i: number) => {
    const value = args[i];
    if (!value) throw new Error(`Missing argument ${i + 1} for ${command}`);
    return value;
  };
  if (command === 'session-sqlite') console.log(sqliteSession(need(0)));
  else if (command === 'session-postgres') console.log(await postgresSession(need(0)));
  else if (command === 'export') await exportBackup(need(0), need(1), need(2));
  else if (command === 'restore') await restoreBackup(need(0), need(1), need(2));
  else if (command === 'compare') {
    const differences = compareBackups(need(0), need(1));
    if (differences.length > 0) {
      console.error(`The move lost or added rows:\n${differences.join('\n')}`);
      process.exit(1);
    }
    console.log('Every table has the same row count on Postgres as on SQLite.');
  } else {
    console.error(
      'Usage: postgres-move-smoke.ts session-sqlite <db> | session-postgres <url> | export <base> <session> <zip> | restore <base> <session> <zip> | compare <sqlite.zip> <postgres.zip>'
    );
    process.exit(2);
  }
}
