import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { userSettings, users } from '../../db/schema';
import { changeTracker } from '../../lib/change-tracker';
import { databaseService } from '../../lib/database';

describe('ChangeTracker', () => {
  let testUserId: string;

  beforeEach(async () => {
    // Create test user
    const db = databaseService.getDatabase();
    const [user] = await db
      .insert(users)
      .values({
        email: `test-${Date.now()}@example.com`,
        displayName: 'Test User',
        provider: 'google',
        providerId: `test-${Date.now()}`,
      })
      .returning();

    testUserId = user.id;

    // Create user settings
    await db.insert(userSettings).values({
      userId: testUserId,
    });
  });

  afterEach(async () => {
    // Clean up
    const db = databaseService.getDatabase();
    const { eq } = await import('drizzle-orm');
    await db.delete(userSettings).where(eq(userSettings.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  test('should mark data as changed', async () => {
    await changeTracker.markDataChanged(testUserId);

    const db = databaseService.getDatabase();
    const { eq } = await import('drizzle-orm');
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, testUserId));

    expect(settings.lastDataChangeDate).toBeDefined();
    expect(settings.lastDataChangeDate).toBeInstanceOf(Date);
  });

  test('should detect changes when no sync has occurred', async () => {
    await changeTracker.markDataChanged(testUserId);

    const hasChanges = await changeTracker.hasChangesSinceLastSync(testUserId);
    expect(hasChanges).toBe(true);
  });

  test('should detect no changes when sync is newer than data change', async () => {
    const db = databaseService.getDatabase();
    const { eq } = await import('drizzle-orm');

    // Mark data changed
    await changeTracker.markDataChanged(testUserId);

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update last sync date to be newer
    await db
      .update(userSettings)
      .set({ lastSyncDate: new Date() })
      .where(eq(userSettings.userId, testUserId));

    const hasChanges = await changeTracker.hasChangesSinceLastSync(testUserId);
    expect(hasChanges).toBe(false);
  });

  test('should detect changes when data change is newer than sync', async () => {
    const db = databaseService.getDatabase();
    const { eq } = await import('drizzle-orm');

    // Set old sync date
    await db
      .update(userSettings)
      .set({ lastSyncDate: new Date(Date.now() - 10000) })
      .where(eq(userSettings.userId, testUserId));

    // Mark data changed now
    await changeTracker.markDataChanged(testUserId);

    const hasChanges = await changeTracker.hasChangesSinceLastSync(testUserId);
    expect(hasChanges).toBe(true);
  });

  test('should return change status', async () => {
    await changeTracker.markDataChanged(testUserId);

    const status = await changeTracker.getChangeStatus(testUserId);

    expect(status.hasChanges).toBe(true);
    expect(status.lastDataChangeDate).toBeDefined();
    expect(status.lastSyncDate).toBeUndefined();
  });
});
