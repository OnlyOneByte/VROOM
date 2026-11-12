import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/connection';
import { userProviders } from '../../db/schema';
import type { BackupConfig, ProviderBackupSettings } from '../../types';
import { decrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { OPERATION_TIMEOUTS, withTimeout } from '../../utils/timeout';
import {
  type BackupOrchestratorResult,
  type BackupOutcome,
  type BackupStrategyResult,
  hasZipBackup,
  isSyncEnabled,
} from './backup-strategy';
import { backupStrategyRegistry } from './backup-strategy-registry';

const MUTEX_TTL_MS = 5 * 60 * 1000;
const MUTEX_MAX_SIZE = 500;
const backupMutex = new Map<string, number>();

export function filterEnabledProviders(config: BackupConfig): [string, ProviderBackupSettings][] {
  return Object.entries(config.providers).filter(([, s]) => isSyncEnabled(s));
}

export function needsZipGeneration(enabledProviders: [string, ProviderBackupSettings][]): boolean {
  return enabledProviders.some(([, s]) => hasZipBackup(s));
}

function acquireMutex(userId: string): boolean {
  const now = Date.now();
  const existing = backupMutex.get(userId);
  if (existing && now - existing < MUTEX_TTL_MS) {
    return false;
  }
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

function failedAttempt(message: string): BackupStrategyResult {
  return { success: false, message, capabilities: {} };
}

export class BackupOrchestrator {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Orchestrator fan-out logic requires sequential steps with error handling per provider
  async execute(
    userId: string,
    displayName: string,
    force = false
  ): Promise<BackupOrchestratorResult> {
    const timestamp = new Date().toISOString();

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
      if (!force) {
        const { activityTracker } = await import('./activity-tracker');
        const hasChanges = await activityTracker.hasChangesSinceLastSync(userId);
        if (!hasChanges) {
          releaseMutex(userId);
          return { timestamp, skipped: true, outcome: 'noop', failedProviders: [], results: {} };
        }
      }

      const { preferencesRepository } = await import('../settings/repository');
      const settings = await preferencesRepository.getOrCreate(userId);
      const config: BackupConfig = (settings.backupConfig as BackupConfig | null) ?? {
        providers: {},
      };

      const enabledProviders = filterEnabledProviders(config);

      if (enabledProviders.length === 0) {
        releaseMutex(userId);
        return { timestamp, outcome: 'noop', failedProviders: [], results: {} };
      }

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

      const db = getDb();
      const providerRows = await db
        .select()
        .from(userProviders)
        .where(and(eq(userProviders.userId, userId)));

      const providerRowMap = new Map(providerRows.map((r) => [r.id, r]));

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
          const message = error instanceof Error ? error.message : 'Backup strategy failed';
          logger.warn('Backup strategy threw, marking provider failed', {
            providerId,
            error: message,
          });
          return { providerId, result: failedAttempt(message) };
        }
      });

      const settled = await Promise.allSettled(strategyPromises);

      const results: Record<string, BackupStrategyResult> = {};
      const configPatch: Record<string, Record<string, string>> = {};
      let anySuccess = false;
      const failedProviders: string[] = [];

      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === 'rejected') {
          const [providerId] = enabledProviders[index];
          const reason = outcome.reason;
          const message = reason instanceof Error ? reason.message : 'Backup strategy failed';
          logger.warn('Backup strategy rejected, marking provider failed', {
            providerId,
            error: message,
          });
          results[providerId] = failedAttempt(message);
          failedProviders.push(providerId);
          continue;
        }

        if (!outcome.value.result) continue;

        const { providerId, result } = outcome.value;
        results[providerId] = result;

        if (result.success) {
          anySuccess = true;
          configPatch[providerId] = { lastBackupAt: timestamp };

          const sheetsId = result.capabilities.sheets?.metadata?.spreadsheetId as
            | string
            | undefined;
          if (sheetsId) {
            configPatch[providerId].sheetsSpreadsheetId = sheetsId;
          }
        } else {
          failedProviders.push(providerId);
        }
      }

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

      if (anySuccess) {
        await preferencesRepository.mergeJsonField(userId, 'backupConfig', {
          providers: configPatch,
        });
      }
      if (runOutcome === 'success') {
        const { syncStateRepository } = await import('../settings/repository');
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
