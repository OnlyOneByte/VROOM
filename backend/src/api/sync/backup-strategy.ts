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

export const hasZipBackup = (settings: ProviderBackupSettings): boolean => settings.enabled;

export const hasSheetsSync = (settings: ProviderBackupSettings): boolean =>
  settings.sheetsSyncEnabled === true;

export const isSyncEnabled = (settings: ProviderBackupSettings): boolean =>
  hasZipBackup(settings) || hasSheetsSync(settings);

export type BackupOutcome = 'success' | 'partial' | 'failed' | 'noop';

export interface BackupOrchestratorResult {
  timestamp: string;
  status?: 'in_progress';
  skipped?: boolean;
  outcome: BackupOutcome;
  failedProviders: string[];
  results: Record<string, BackupStrategyResult>;
}
