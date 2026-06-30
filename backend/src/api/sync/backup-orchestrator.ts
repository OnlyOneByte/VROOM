import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import type { BackupConfig, ProviderBackupSettings } from '../../types';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import type {
  BackupOrchestratorResult,
  BackupOutcome,
  BackupStrategyResult,
} from './backup-strategy';
import { backupStrategyRegistry } from './backup-strategy-registry';

const MUTEX_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MUTEX_MAX_SIZE = 500;
const backupMutex = new Map<string, number>();

/**
 * The providers a backup run will fan out to: enabled (ZIP) OR sheetsSyncEnabled. Pure +
 * exported so the orchestrator and its tests share ONE source of truth — previously the test
 * re-implemented this filter locally and asserted against the copy, leaving the real branch
 * uncovered (coverage theater, C181). execute() calls this so the test now pins real code.
 */
export function filterEnabledProviders(config: BackupConfig): [string, ProviderBackupSettings][] {
  return Object.entries(config.providers).filter(
    ([, s]) => s.enabled || s.sheetsSyncEnabled === true
  );
}

/** A ZIP is generated only if at least one selected provider has enabled=true (Sheets-only skips it). */
export function needsZipGeneration(enabledProviders: [string, ProviderBackupSettings][]): boolean {
  return enabledProviders.some(([, s]) => s.enabled);
}

function acquireMutex(userId: string): boolean {
  const now = Date.now();
  const existing = backupMutex.get(userId);
  if (existing && now - existing < MUTEX_TTL_MS) {
    return false;
  }
  // Evict stale entries if map is too large
  if (backupMutex.size >= MUTEX_MAX_SIZE) {
    for (const [key, ts] of backupMutex) {
      if (now - ts >= MUTEX_TTL_MS) {
        backupMutex.delete(key);
      }
    }
  }
  backupMutex.set(userId, now);
  return true;
}

function releaseMutex(userId: string): void {
  backupMutex.delete(userId);
}

export class BackupOrchestrator {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Orchestrator fan-out logic requires sequential steps with error handling per provider
  async execute(
    userId: string,
    displayName: string,
    force = false
  ): Promise<BackupOrchestratorResult> {
    const timestamp = new Date().toISOString();

    // Mutex check
    if (!acquireMutex(userId)) {
      return {
        timestamp,
        status: 'in_progress',
        outcome: 'noop',
        failedProviders: [],
        results: {},
      };
    }

    try {
      // Change detection
      if (!force) {
        const { activityTracker } = await import('./activity-tracker');
        const hasChanges = await activityTracker.hasChangesSinceLastSync(userId);
        if (!hasChanges) {
          releaseMutex(userId);
          return { timestamp, skipped: true, outcome: 'noop', failedProviders: [], results: {} };
        }
      }

      // Load backup config — own filter including sheetsSyncEnabled
      const { preferencesRepository } = await import('../settings/repository');
      const settings = await preferencesRepository.getOrCreate(userId);
      const config: BackupConfig = (settings.backupConfig as BackupConfig | null) ?? {
        providers: {},
      };

      const enabledProviders = filterEnabledProviders(config);

      // No enabled providers
      if (enabledProviders.length === 0) {
        releaseMutex(userId);
        return { timestamp, outcome: 'noop', failedProviders: [], results: {} };
      }

      // Conditional ZIP generation — only if any provider has enabled=true
      const needsZip = needsZipGeneration(enabledProviders);
      let zipBuffer: Buffer | null = null;
      if (needsZip) {
        try {
          const { backupService } = await import('./backup');
          zipBuffer = await backupService.exportAsZip(userId);
        } catch (error) {
          logger.warn('ZIP generation failed, continuing with Sheets-only', {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Load provider rows and decrypt credentials
      const db = getDb();
      const providerRows = await db
        .select()
        .from(userProviders)
        .where(and(eq(userProviders.userId, userId)));

      const providerRowMap = new Map(providerRows.map((r) => [r.id, r]));

      // Parallel fan-out via Promise.allSettled
      const strategyPromises = enabledProviders.map(async ([providerId, providerConfig]) => {
        const strategy = backupStrategyRegistry.get(
          providerRowMap.get(providerId)?.providerType ?? ''
        );
        if (!strategy) {
          logger.debug('No strategy registered for provider, skipping', { providerId });
          return { providerId, result: null };
        }

        const providerRow = providerRowMap.get(providerId);
        if (!providerRow) {
          logger.warn('Provider row not found, skipping', { providerId });
          return { providerId, result: null };
        }

        let decryptedCredentials: Record<string, unknown>;
        try {
          decryptedCredentials = JSON.parse(decrypt(providerRow.credentials)) as Record<
            string,
            unknown
          >;
        } catch (error) {
          logger.warn('Failed to decrypt provider credentials, skipping', {
            providerId,
            error: error instanceof Error ? error.message : String(error),
          });
          return { providerId, result: null };
        }

        try {
          const result = await withTimeout(
            strategy.execute({
              userId,
              displayName,
              providerId,
              providerRow,
              decryptedCredentials,
              providerConfig,
              zipBuffer,
            }),
            OPERATION_TIMEOUTS.BACKUP,
            `Backup strategy for ${providerId}`
          );
          return { providerId, result };
        } catch (error) {
          // A thrown/timed-out strategy is a REAL failure of an attempted provider, not a silent
          // skip (#44): catch it HERE so the providerId is retained and the run is marked failed.
          // (Previously the rejection was swallowed in the settled loop → fail-open 200.)
          const message = error instanceof Error ? error.message : 'Backup strategy failed';
          logger.warn('Backup strategy threw, marking provider failed', {
            providerId,
            error: message,
          });
          return { providerId, result: { success: false, message, capabilities: {} } };
        }
      });

      const settled = await Promise.allSettled(strategyPromises);

      // Collect results — track BOTH succeeded and failed providers so the run-level outcome is honest.
      const results: Record<string, BackupStrategyResult> = {};
      const updatedConfig = { ...config, providers: { ...config.providers } };
      let anySuccess = false;
      const failedProviders: string[] = [];

      for (const outcome of settled) {
        // A null result = a provider we never attempted (no strategy registered / no row / undecryptable
        // credentials). It is a skip, not a backup failure — excluded from the success/failure tally.
        if (outcome.status !== 'fulfilled' || !outcome.value.result) {
          if (outcome.status === 'rejected') {
            // The map body catches its own throws, so a rejection here is unexpected — count it as a
            // failure rather than swallow it (no providerId available, so it cannot retry-stamp anyway).
            logger.warn('Strategy execution rejected', { error: outcome.reason });
          }
          continue;
        }

        const { providerId, result } = outcome.value;
        results[providerId] = result;

        if (result.success) {
          anySuccess = true;
          updatedConfig.providers[providerId] = {
            ...updatedConfig.providers[providerId],
            lastBackupAt: timestamp,
          };

          // Persist sheetsSpreadsheetId from strategy result
          const sheetsId = result.capabilities.sheets?.metadata?.spreadsheetId as
            | string
            | undefined;
          if (sheetsId) {
            updatedConfig.providers[providerId] = {
              ...updatedConfig.providers[providerId],
              sheetsSpreadsheetId: sheetsId,
            };
          }
        } else {
          failedProviders.push(providerId);
        }
      }

      // Honest run-level outcome (#44): failed = every attempted provider failed; partial = a mix;
      // success = all clean; noop = nothing attempted (no provider produced a result).
      const attemptedCount = Object.keys(results).length;
      let runOutcome: BackupOutcome;
      if (attemptedCount === 0) {
        runOutcome = 'noop';
      } else if (failedProviders.length === 0) {
        runOutcome = 'success';
      } else if (anySuccess) {
        runOutcome = 'partial';
      } else {
        runOutcome = 'failed';
      }

      // Persist config updates (succeeded providers always record their lastBackupAt + sheets id so a
      // partial run does not lose a provider that DID succeed). But the GLOBAL sync/backup anchor only
      // advances on a fully-clean run — if ANY provider failed, the user still has un-synced changes,
      // so leaving the anchor un-advanced is what makes the failed provider RETRY next run (#43). A
      // partial-success that advanced the anchor would strand the failed provider forever.
      if (anySuccess) {
        await preferencesRepository.update(userId, { backupConfig: updatedConfig });
      }
      if (runOutcome === 'success') {
        const { syncStateRepository } = await import('../settings/repository');
        // Stamp lastSyncDate from the run's START timestamp (the snapshot anchor — taken before the
        // change-check + ZIP export above), NOT a fresh end-of-run time. A long backup can run for
        // minutes; a data change made mid-run (after the snapshot) must stay "unsynced" so the NEXT
        // backup captures it. Stamping end-of-run would mark that change already-synced and silently
        // drop it from every future backup (C144 #42). Using the start timestamp (slightly before the
        // actual L85 snapshot) errs safe: at worst a redundant re-backup, never a lost change.
        await syncStateRepository.updateSyncDate(userId, new Date(timestamp));
        await syncStateRepository.updateBackupDate(userId);
      }

      return { timestamp, outcome: runOutcome, failedProviders, results };
    } finally {
      releaseMutex(userId);
    }
  }
}

export const backupOrchestrator = new BackupOrchestrator();
