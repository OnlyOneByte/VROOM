import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import type { BackupConfig, ProviderBackupSettings } from '../../types';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import type { BackupOrchestratorResult, BackupStrategyResult } from './backup-strategy';
import { backupStrategyRegistry } from './backup-strategy-registry';

const MUTEX_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MUTEX_MAX_SIZE = 500;
const backupMutex = new Map<string, number>();

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
      return { timestamp, status: 'in_progress', results: {} };
    }

    try {
      // Change detection
      if (!force) {
        const { activityTracker } = await import('./activity-tracker');
        const hasChanges = await activityTracker.hasChangesSinceLastSync(userId);
        if (!hasChanges) {
          releaseMutex(userId);
          return { timestamp, skipped: true, results: {} };
        }
      }

      // Load backup config — own filter including sheetsSyncEnabled
      const { settingsRepository } = await import('../settings/repository');
      const settings = await settingsRepository.getOrCreate(userId);
      const config: BackupConfig = (settings.backupConfig as BackupConfig | null) ?? {
        providers: {},
      };

      const enabledProviders: [string, ProviderBackupSettings][] = Object.entries(
        config.providers
      ).filter(([, s]) => s.enabled || s.sheetsSyncEnabled === true);

      // No enabled providers
      if (enabledProviders.length === 0) {
        releaseMutex(userId);
        return { timestamp, results: {} };
      }

      // Conditional ZIP generation — only if any provider has enabled=true
      const needsZip = enabledProviders.some(([, s]) => s.enabled);
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
      });

      const settled = await Promise.allSettled(strategyPromises);

      // Collect results
      const results: Record<string, BackupStrategyResult> = {};
      const updatedConfig = { ...config, providers: { ...config.providers } };
      let anySuccess = false;

      for (const outcome of settled) {
        if (outcome.status !== 'fulfilled' || !outcome.value.result) {
          if (outcome.status === 'fulfilled' && !outcome.value.result) {
            // Skipped provider (no strategy or no row)
            continue;
          }
          if (outcome.status === 'rejected') {
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
        }
      }

      // Persist config updates
      if (anySuccess) {
        await settingsRepository.updateBackupConfig(userId, updatedConfig);
        await settingsRepository.updateSyncDate(userId);
      }

      return { timestamp, results };
    } finally {
      releaseMutex(userId);
    }
  }
}

export const backupOrchestrator = new BackupOrchestrator();
