import type { BackupStrategy } from './backup-strategy';

class BackupStrategyRegistry {
  private strategies = new Map<string, BackupStrategy>();

  register(providerType: string, strategy: BackupStrategy): void {
    this.strategies.set(providerType, strategy);
  }

  get(providerType: string): BackupStrategy | undefined {
    return this.strategies.get(providerType);
  }
}

export const backupStrategyRegistry = new BackupStrategyRegistry();
