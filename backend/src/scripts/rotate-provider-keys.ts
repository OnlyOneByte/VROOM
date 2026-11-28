import { and, asc, eq, gt } from 'drizzle-orm';
import type { AsyncAppDatabase } from '../db/async-sqlite';
import { userProviders } from '../db/schema';
import { decrypt, encrypt, isCurrentEnvelope, secretContextOf } from '../utils/encryption';

export interface RotationReport {
  rotated: number;
  unchanged: number;
  empty: number;
  failed: string[];
}

const BATCH_SIZE = 100;

interface SecretRow {
  id: string;
  userId: string;
  domain: string;
  credentials: string;
}

function rotatedSecret(row: SecretRow, report: RotationReport): string | null {
  if (row.credentials === '') {
    report.empty++;
    return null;
  }
  if (isCurrentEnvelope(row.credentials)) {
    report.unchanged++;
    return null;
  }
  const context = secretContextOf(row);
  try {
    return encrypt(decrypt(row.credentials, context), context);
  } catch {
    report.failed.push(row.id);
    return null;
  }
}

export async function rotateProviderKeys(
  asyncDb: AsyncAppDatabase,
  batchSize = BATCH_SIZE
): Promise<RotationReport> {
  const report: RotationReport = { rotated: 0, unchanged: 0, empty: 0, failed: [] };
  let after = '';
  for (;;) {
    const rows = await asyncDb
      .select({
        id: userProviders.id,
        userId: userProviders.userId,
        domain: userProviders.domain,
        credentials: userProviders.credentials,
      })
      .from(userProviders)
      .where(gt(userProviders.id, after))
      .orderBy(asc(userProviders.id))
      .limit(batchSize);
    const last = rows.at(-1);
    if (!last) return report;
    const changes = rows.flatMap((row) => {
      const credentials = rotatedSecret(row, report);
      return credentials === null ? [] : [{ row, credentials }];
    });
    await asyncDb.transaction(async (tx) => {
      for (const { row, credentials } of changes) {
        const written = await tx
          .update(userProviders)
          .set({ credentials })
          .where(and(eq(userProviders.id, row.id), eq(userProviders.credentials, row.credentials)))
          .returning({ id: userProviders.id });
        if (written.length > 0) report.rotated++;
        else report.unchanged++;
      }
    });
    after = last.id;
  }
}

if (import.meta.main) {
  const { ACTIVE_DIALECT } = await import('../db/dialect/active');
  if (ACTIVE_DIALECT === 'pg') await (await import('../db/connection')).runMigrations();
  const { appContext } = await import('../app-context');
  const report = await rotateProviderKeys(appContext().asyncDb);
  console.log(
    `Provider secrets: ${report.rotated} re-encrypted, ${report.unchanged} already on the current key, ${report.empty} with no secret, ${report.failed.length} unreadable.`
  );
  if (report.failed.length > 0) {
    console.error(
      `Could not decrypt these provider rows with any configured key: ${report.failed.join(', ')}`
    );
    process.exit(1);
  }
}
