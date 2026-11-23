import { and, asc, eq, gt } from 'drizzle-orm';
import type { AppDatabase } from '../db/connection';
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

export function rotateProviderKeys(database: AppDatabase, batchSize = BATCH_SIZE): RotationReport {
  const report: RotationReport = { rotated: 0, unchanged: 0, empty: 0, failed: [] };
  let after = '';
  for (;;) {
    const lastId = database.transaction((tx) => {
      const rows = tx
        .select({
          id: userProviders.id,
          userId: userProviders.userId,
          domain: userProviders.domain,
          credentials: userProviders.credentials,
        })
        .from(userProviders)
        .where(gt(userProviders.id, after))
        .orderBy(asc(userProviders.id))
        .limit(batchSize)
        .all();
      for (const row of rows) {
        const credentials = rotatedSecret(row, report);
        if (credentials === null) continue;
        const written = tx
          .update(userProviders)
          .set({ credentials })
          .where(and(eq(userProviders.id, row.id), eq(userProviders.credentials, row.credentials)))
          .returning({ id: userProviders.id })
          .all();
        if (written.length > 0) report.rotated++;
        else report.unchanged++;
      }
      return rows.at(-1)?.id ?? null;
    });
    if (lastId === null) return report;
    after = lastId;
  }
}

if (import.meta.main) {
  const { getDb } = await import('../db/connection');
  const report = rotateProviderKeys(getDb());
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
