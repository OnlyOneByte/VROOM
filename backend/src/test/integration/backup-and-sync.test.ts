import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { expenses, users, vehicles } from '../../db/schema';
import { syncOrchestrator } from '../../lib/services/sync/sync-orchestrator';
import {
  clearTestData,
  type getTestDatabase,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup';
import { getDb } from '../utils/test-helpers';

describe('Sync Service Integration Tests', () => {
  let _db: ReturnType<typeof getTestDatabase>;
  const testUserId = 'test-backup-sync-user-id';
  const testEmail = 'backup-sync-test@example.com';

  beforeAll(() => {
    _db = setupTestDatabase();
  });

  beforeEach(async () => {
    clearTestData();
    const db = getDb();

    // Clean up any existing test data - delete in correct order
    await db.delete(vehicles);
    await db.delete(users).where(eq(users.email, testEmail));

    // Create test user
    await db.insert(users).values({
      id: testUserId,
      email: testEmail,
      displayName: 'Backup Sync Test User',
      provider: 'google',
      providerId: 'backup-sync-test-provider-id',
    });
  });

  afterEach(async () => {
    const db = getDb();
    // Clean up - delete in correct order (vehicles cascade deletes expenses)
    await db.delete(vehicles);
    await db.delete(users).where(eq(users.email, testEmail));
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('Backup Creation and Export', () => {
    test('should create backup with all user data', async () => {
      const db = getDb();

      // Create test data
      const vehicle = await db
        .insert(vehicles)
        .values({
          id: 'vehicle-1',
          userId: testUserId,
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          licensePlate: 'ABC123',
        })
        .returning();

      await db.insert(expenses).values({
        id: 'expense-1',
        vehicleId: vehicle[0].id,
        category: 'fuel',
        amount: 50.0,
        currency: 'USD',
        date: new Date('2024-01-01'),
      });

      // Create backup via orchestrator
      const backup = await syncOrchestrator.createBackup(testUserId);

      expect(backup.metadata.userId).toBe(testUserId);
      expect(backup.metadata.version).toBe('1.0.0');
      expect(backup.vehicles).toHaveLength(1);
      expect(backup.expenses).toHaveLength(1);
    });

    test('should export backup as ZIP', async () => {
      const db = getDb();

      // Create test data
      await db.insert(vehicles).values({
        id: 'vehicle-1',
        userId: testUserId,
        make: 'Honda',
        model: 'Civic',
        year: 2021,
        licensePlate: 'XYZ789',
      });

      // Export as ZIP via orchestrator
      const zipBuffer = await syncOrchestrator.exportBackupAsZip(testUserId);

      expect(zipBuffer).toBeInstanceOf(Buffer);
      expect(zipBuffer.length).toBeGreaterThan(0);
    });
  });

  describe('Backup Restore - Replace Mode', () => {
    test('should delete all existing data in replace mode', async () => {
      const db = getDb();

      // Create initial data
      const vehicle1 = await db
        .insert(vehicles)
        .values({
          id: 'vehicle-1',
          userId: testUserId,
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          licensePlate: 'ABC123',
        })
        .returning();

      const vehicle2 = await db
        .insert(vehicles)
        .values({
          id: 'vehicle-2',
          userId: testUserId,
          make: 'Honda',
          model: 'Civic',
          year: 2021,
          licensePlate: 'XYZ789',
        })
        .returning();

      await db.insert(expenses).values([
        {
          id: 'expense-1',
          vehicleId: vehicle1[0].id,
          category: 'fuel',
          amount: 50.0,
          currency: 'USD',
          date: new Date('2024-01-01'),
        },
        {
          id: 'expense-2',
          vehicleId: vehicle2[0].id,
          category: 'maintenance',
          amount: 100.0,
          currency: 'USD',
          date: new Date('2024-01-02'),
        },
      ]);

      // Verify initial data exists
      const initialVehicles = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, testUserId));
      const initialExpenses = await db.select().from(expenses);
      expect(initialVehicles).toHaveLength(2);
      expect(initialExpenses).toHaveLength(2);

      // Create a real backup from the current data via orchestrator
      const backupZip = await syncOrchestrator.exportBackupAsZip(testUserId);

      // Restore in replace mode via orchestrator - this should delete and re-insert the same data
      const result = await syncOrchestrator.restoreFromBackup(testUserId, backupZip, 'replace');

      expect(result.success).toBe(true);
      expect(result.imported).toBeDefined();
      expect(result.imported?.vehicles).toBe(2);
      expect(result.imported?.expenses).toBe(2);

      // Verify data is still there after replace
      const finalVehicles = await db.select().from(vehicles).where(eq(vehicles.userId, testUserId));
      const finalExpenses = await db.select().from(expenses);

      expect(finalVehicles).toHaveLength(2);
      expect(finalExpenses).toHaveLength(2);

      // Verify the vehicles are the same ones (by ID)
      const vehicleIds = finalVehicles.map((v) => v.id).sort();
      expect(vehicleIds).toEqual(['vehicle-1', 'vehicle-2']);
    });

    test('should handle multiple vehicles with expenses correctly', async () => {
      const db = getDb();

      // Create 3 vehicles with multiple expenses each
      for (let i = 1; i <= 3; i++) {
        const vehicle = await db
          .insert(vehicles)
          .values({
            id: `vehicle-${i}`,
            userId: testUserId,
            make: `Make${i}`,
            model: `Model${i}`,
            year: 2020 + i,
            licensePlate: `TEST${i}`,
          })
          .returning();

        // Add 2 expenses per vehicle
        await db.insert(expenses).values([
          {
            id: `expense-${i}-1`,
            vehicleId: vehicle[0].id,
            category: 'fuel',
            amount: 50.0 * i,
            currency: 'USD',
            date: new Date(`2024-01-0${i}`),
          },
          {
            id: `expense-${i}-2`,
            vehicleId: vehicle[0].id,
            category: 'maintenance',
            amount: 100.0 * i,
            currency: 'USD',
            date: new Date(`2024-02-0${i}`),
          },
        ]);
      }

      // Verify initial data
      const initialVehicles = await db
        .select()
        .from(vehicles)
        .where(eq(vehicles.userId, testUserId));
      const initialExpenses = await db.select().from(expenses);
      expect(initialVehicles).toHaveLength(3);
      expect(initialExpenses).toHaveLength(6);

      // Create backup and restore via orchestrator
      const backupZip = await syncOrchestrator.exportBackupAsZip(testUserId);
      const result = await syncOrchestrator.restoreFromBackup(testUserId, backupZip, 'replace');

      expect(result.success).toBe(true);
      expect(result.imported?.vehicles).toBe(3);
      expect(result.imported?.expenses).toBe(6);

      // Verify all data is restored
      const finalVehicles = await db.select().from(vehicles).where(eq(vehicles.userId, testUserId));
      const finalExpenses = await db.select().from(expenses);
      expect(finalVehicles).toHaveLength(3);
      expect(finalExpenses).toHaveLength(6);
    });
  });

  describe('Backup Restore - Preview Mode', () => {
    test('should return summary without modifying data', async () => {
      const db = getDb();

      // Create test data
      await db.insert(vehicles).values({
        id: 'vehicle-1',
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'ABC123',
      });

      // Create backup via orchestrator
      const backupZip = await syncOrchestrator.exportBackupAsZip(testUserId);

      // Preview restore via orchestrator
      const result = await syncOrchestrator.restoreFromBackup(testUserId, backupZip, 'preview');

      expect(result.success).toBe(true);
      expect(result.preview).toBeDefined();
      expect(result.preview?.vehicles).toBe(1);
      expect(result.imported).toBeUndefined();
    });
  });

  describe('Backup Validation', () => {
    test('should reject backup from different user', async () => {
      const db = getDb();

      // Create data for test user
      await db.insert(vehicles).values({
        id: 'vehicle-1',
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'ABC123',
      });

      // Create backup via orchestrator
      const backupZip = await syncOrchestrator.exportBackupAsZip(testUserId);

      // Try to restore with different user ID via orchestrator
      await expect(
        syncOrchestrator.restoreFromBackup('different-user-id', backupZip, 'replace')
      ).rejects.toThrow('Backup file belongs to a different user');
    });
  });

  describe('ZIP Parsing', () => {
    test('should parse valid ZIP backup', async () => {
      const db = getDb();

      // Create test data
      await db.insert(vehicles).values({
        id: 'vehicle-1',
        userId: testUserId,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'ABC123',
      });

      // Create and parse backup via orchestrator
      const backupZip = await syncOrchestrator.exportBackupAsZip(testUserId);
      const { backupParser } = await import('../../lib/services/backup/backup-parser');
      const parsed = await backupParser.parseZipBackup(backupZip);

      expect(parsed.metadata.userId).toBe(testUserId);
      expect(parsed.metadata.version).toBe('1.0.0');
      expect(parsed.vehicles).toHaveLength(1);
    });

    test('should reject invalid ZIP format', async () => {
      const invalidZip = Buffer.from('not a zip file');
      const { backupParser } = await import('../../lib/services/backup/backup-parser');

      await expect(backupParser.parseZipBackup(invalidZip)).rejects.toThrow(
        'Failed to parse ZIP backup'
      );
    });
  });
});
