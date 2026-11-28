import { ON_POSTGRES } from './http-client';
import type { TestSql } from './test-sql';

export interface FailWrites {
  name: string;
  table: string;
  event: string;
  message: string;
  when?: string;
}

export async function failWrites(sql: TestSql, rule: FailWrites): Promise<() => Promise<void>> {
  const message = rule.message.replaceAll("'", "''");
  const when = rule.when ?? 'TRUE';
  if (!ON_POSTGRES) {
    await sql.run(
      `CREATE TRIGGER ${rule.name} BEFORE ${rule.event} ON ${rule.table} WHEN ${when} BEGIN SELECT RAISE(ABORT, '${message}'); END`
    );
    return async () => {
      await sql.run(`DROP TRIGGER ${rule.name}`);
    };
  }
  await sql.run(
    `CREATE OR REPLACE FUNCTION ${rule.name}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION USING MESSAGE = '${message}'; END $$ LANGUAGE plpgsql`
  );
  await sql.run(
    `CREATE TRIGGER ${rule.name} BEFORE ${rule.event} ON ${rule.table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${rule.name}()`
  );
  return async () => {
    await sql.run(`DROP TRIGGER ${rule.name} ON ${rule.table}`);
    await sql.run(`DROP FUNCTION ${rule.name}()`);
  };
}
