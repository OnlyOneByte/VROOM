import type { UserProvider } from '../../db/schema';
import type { ProviderBackupSettings } from '../../types';

export interface BackupStrategyContext {
  userId: string;
  displayName: string;
  providerId: string;
  providerRow: UserProvider;
  decryptedCredentials: Record<string, unknown>;
  providerConfig: ProviderBackupSettings;
  zipBuffer: Buffer | null;
}

export interface BackupCapabilityResult {
  success: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface BackupStrategyResult {
  success: boolean;
  message?: string;
  capabilities: Record<string, BackupCapabilityResult>;
}

export interface BackupStrategy {
  execute(context: BackupStrategyContext): Promise<BackupStrategyResult>;
}

/**
 * success: every attempted provider backed up cleanly. partial: some succeeded and some failed.
 * failed: every attempted provider failed. noop: nothing was attempted.
 */
export type BackupOutcome = 'success' | 'partial' | 'failed' | 'noop';

export interface BackupOrchestratorResult {
  timestamp: string;
  status?: 'in_progress';
  skipped?: boolean;
  outcome: BackupOutcome;
  /** Provider ids that did not fully succeed. A non-empty list keeps the sync anchor from advancing. */
  failedProviders: string[];
  results: Record<string, BackupStrategyResult>;
}
