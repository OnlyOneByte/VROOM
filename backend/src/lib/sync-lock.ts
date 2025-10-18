/**
 * Sync lock manager to prevent concurrent sync operations
 *
 * ⚠️ PRODUCTION WARNING:
 * This is an in-memory implementation that will NOT work correctly in:
 * - Multi-instance deployments (horizontal scaling)
 * - Serverless environments (state is lost between invocations)
 * - Load-balanced setups (locks are not shared across instances)
 *
 * For production, replace with:
 * - Redis (recommended): Use SET NX EX for atomic lock acquisition
 * - Database-based locks: Use SELECT FOR UPDATE or advisory locks
 * - Distributed lock service: e.g., etcd, Consul
 */
export class SyncLock {
  private locks = new Map<string, { timestamp: number; ttl: number }>();
  private cleanupInterval: Timer | null = null;

  constructor() {
    // Clean up expired locks every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async acquire(userId: string, ttl = 300000): Promise<boolean> {
    const existing = this.locks.get(userId);
    if (existing && Date.now() - existing.timestamp < existing.ttl) {
      return false;
    }

    this.locks.set(userId, { timestamp: Date.now(), ttl });
    return true;
  }

  release(userId: string): void {
    this.locks.delete(userId);
  }

  isLocked(userId: string): boolean {
    const existing = this.locks.get(userId);
    if (!existing) return false;
    return Date.now() - existing.timestamp < existing.ttl;
  }

  getActiveLockCount(): number {
    this.cleanup();
    return this.locks.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [userId, lock] of this.locks.entries()) {
      if (now - lock.timestamp >= lock.ttl) {
        this.locks.delete(userId);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.locks.clear();
  }
}

export const syncLock = new SyncLock();
