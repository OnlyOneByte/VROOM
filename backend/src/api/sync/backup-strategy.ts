import type { UserProvider } from '../../db/schema';
import type { ProviderBackupSettings } from '../../types';
import { storageProviderDescriptor } from '../providers/domains/storage/registry';

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

export const isPhotoOnlyProviderType = (providerType: string): boolean =>
  storageProviderDescriptor(providerType)?.photoOnly === true;

export const hasZipBackup = (
  settings: ProviderBackupSettings,
  providerType: string | undefined
): boolean => settings.enabled && !isPhotoOnlyProviderType(providerType ?? '');

export const hasSheetsSync = (settings: ProviderBackupSettings): boolean =>
  settings.sheetsSyncEnabled === true;

export const isSyncEnabled = (
  settings: ProviderBackupSettings,
  providerType: string | undefined
): boolean => hasZipBackup(settings, providerType) || hasSheetsSync(settings);

export type BackupOutcome = 'success' | 'partial' | 'failed' | 'noop';

export interface BackupOrchestratorResult {
  timestamp: string;
  status?: 'in_progress';
  skipped?: boolean;
  outcome: BackupOutcome;
  failedProviders: string[];
  results: Record<string, BackupStrategyResult>;
}
