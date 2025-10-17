import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { expenses, users, vehicles } from '../../db/schema';
import { backupService } from '../../lib/backup-service';
import { syncService } from '../../lib/sync-service';
import {
  clearTestData,
  type getTestDatabase,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup';
import { getDb } from '../utils/test-helpers';

describe('Restore Replace Mode Fix', () => {
  let _db: ReturnType<typeof getTestDatabase>;
  const testUserId = 'test-restore-user-id';
  const testEmail = 'restore-test@example.com';

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
      displayName: 'Restore Test User',
      provider: 'google',
      providerId: 'restore-test-provider-id',
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
    const initialVehicles = await db.select().from(vehicles).where(eq(vehicles.userId, testUserId));
    const initialExpenses = await db.select().from(expenses);
    expect(initialVehicles).toHaveLength(2);
    expect(initialExpenses).toHaveLength(2);

    // Create a real backup from the current data
    const backupZip = await backupService.exportAsZip(testUserId);

    // Restore in replace mode - this should delete and re-insert the same data
    const result = await syncService.restoreFromBackup(testUserId, backupZip, 'replace');

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
    const initialVehicles = await db.select().from(vehicles).where(eq(vehicles.userId, testUserId));
    const initialExpenses = await db.select().from(expenses);
    expect(initialVehicles).toHaveLength(3);
    expect(initialExpenses).toHaveLength(6);

    // Create backup and restore
    const backupZip = await backupService.exportAsZip(testUserId);
    const result = await syncService.restoreFromBackup(testUserId, backupZip, 'replace');

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
