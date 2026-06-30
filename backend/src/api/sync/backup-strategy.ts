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
 * The honest run-level verdict (#44): `success` = every attempted provider backed up cleanly;
 * `partial` = at least one provider succeeded AND at least one failed; `failed` = every attempted
 * provider failed; `noop` = nothing was attempted (no enabled providers / skipped / in-progress).
 * The route maps this to an HTTP status (success/noop → 200, partial → 207, failed → 502) so a
 * failed backup is no longer silently reported as a 200 success.
 */
export type BackupOutcome = 'success' | 'partial' | 'failed' | 'noop';

export interface BackupOrchestratorResult {
  timestamp: string;
  status?: 'in_progress';
  skipped?: boolean;
  outcome: BackupOutcome;
  /** Provider ids whose backup did not fully succeed (drives retry — their sync anchor is NOT advanced). */
  failedProviders: string[];
  results: Record<string, BackupStrategyResult>;
}
