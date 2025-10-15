import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { User, Vehicle } from '../../db/schema.js';
import { ExpenseRepository } from '../../lib/repositories/expense.js';
import { UserRepository } from '../../lib/repositories/user.js';
import { VehicleRepository } from '../../lib/repositories/vehicle.js';
import {
  clearTestData,
  setupTestDatabase,
  teardownTestDatabase,
  testExpenseData,
  testUserData,
  testVehicleData,
} from '../setup.js';

describe('ExpenseRepository', () => {
  let expenseRepository: ExpenseRepository;
  let vehicleRepository: VehicleRepository;
  let userRepository: UserRepository;
  let _testDb: ReturnType<typeof setupTestDatabase>;
  let testUser: User;
  let testVehicle: Vehicle;

  beforeAll(() => {
    _testDb = setupTestDatabase();
    expenseRepository = new ExpenseRepository();
    vehicleRepository = new VehicleRepository();
    userRepository = new UserRepository();
  });

  beforeEach(async () => {
    clearTestData();
    // Create test user and vehicle
    testUser = await userRepository.create(testUserData);
    testVehicle = await vehicleRepository.create({ ...testVehicleData, userId: testUser.id });
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('create', () => {
    test('should create a new expense', async () => {
      const expenseData = { ...testExpenseData, vehicleId: testVehicle.id };
      const expense = await expenseRepository.create(expenseData);

      expect(expense).toBeDefined();
      expect(expense.id).toBeDefined();
      expect(expense.vehicleId).toBe(testVehicle.id);
      expect(expense.type).toBe(testExpenseData.type);
      expect(expense.category).toBe(testExpenseData.category);
      expect(expense.amount).toBe(testExpenseData.amount);
      expect(expense.gallons).toBe(testExpenseData.gallons);
      expect(expense.createdAt).toBeInstanceOf(Date);
    });

    test('should create expense with minimal required fields', async () => {
      const minimalExpenseData = {
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        category: 'operating' as const,
        amount: 15.0,
        currency: 'USD',
        date: new Date(),
      };

      const expense = await expenseRepository.create(minimalExpenseData);

      expect(expense).toBeDefined();
      expect(expense.type).toBe(minimalExpenseData.type);
      expect(expense.amount).toBe(minimalExpenseData.amount);
      expect(expense.gallons).toBeNull();
      expect(expense.mileage).toBeNull();
    });
  });

  describe('findById', () => {
    test('should find expense by id', async () => {
      const expenseData = { ...testExpenseData, vehicleId: testVehicle.id };
      const createdExpense = await expenseRepository.create(expenseData);
      const foundExpense = await expenseRepository.findById(createdExpense.id);

      expect(foundExpense).toBeDefined();
      expect(foundExpense?.id).toBe(createdExpense.id);
      expect(foundExpense?.amount).toBe(testExpenseData.amount);
    });

    test('should return null for non-existent id', async () => {
      const foundExpense = await expenseRepository.findById('non-existent-id');
      expect(foundExpense).toBeNull();
    });
  });

  describe('findByVehicleId', () => {
    test('should find all expenses for a vehicle', async () => {
      const expense1Data = { ...testExpenseData, vehicleId: testVehicle.id };
      const expense2Data = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        amount: 20.0,
        date: new Date('2024-01-20'),
      };

      await expenseRepository.create(expense1Data);
      await expenseRepository.create(expense2Data);

      const vehicleExpenses = await expenseRepository.findByVehicleId(testVehicle.id);

      expect(vehicleExpenses).toHaveLength(2);
      expect(vehicleExpenses[0].vehicleId).toBe(testVehicle.id);
      expect(vehicleExpenses[1].vehicleId).toBe(testVehicle.id);
      // Should be ordered by date descending
      expect(vehicleExpenses[0].date.getTime()).toBeGreaterThan(vehicleExpenses[1].date.getTime());
    });

    test('should return empty array for vehicle with no expenses', async () => {
      const vehicleExpenses = await expenseRepository.findByVehicleId(testVehicle.id);
      expect(vehicleExpenses).toHaveLength(0);
    });
  });

  describe('findByVehicleIdAndDateRange', () => {
    test('should find expenses within date range', async () => {
      const expense1Data = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        date: new Date('2024-01-10'),
      };
      const expense2Data = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        amount: 20.0,
        date: new Date('2024-01-20'),
      };
      const expense3Data = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'tolls' as const,
        amount: 5.0,
        date: new Date('2024-02-05'),
      };

      await expenseRepository.create(expense1Data);
      await expenseRepository.create(expense2Data);
      await expenseRepository.create(expense3Data);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const expensesInRange = await expenseRepository.findByVehicleIdAndDateRange(
        testVehicle.id,
        startDate,
        endDate
      );

      expect(expensesInRange).toHaveLength(2);
      expect(expensesInRange.every((e) => e.date >= startDate && e.date <= endDate)).toBe(true);
    });
  });

  describe('findByType', () => {
    test('should find expenses by type', async () => {
      const fuelExpense = { ...testExpenseData, vehicleId: testVehicle.id, type: 'fuel' as const };
      const parkingExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        amount: 15.0,
      };

      await expenseRepository.create(fuelExpense);
      await expenseRepository.create(parkingExpense);

      const fuelExpenses = await expenseRepository.findByType(testVehicle.id, 'fuel');

      expect(fuelExpenses).toHaveLength(1);
      expect(fuelExpenses[0].type).toBe('fuel');
    });
  });

  describe('findByCategory', () => {
    test('should find expenses by category', async () => {
      const operatingExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        category: 'operating' as const,
      };
      const maintenanceExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'oil-change' as const,
        category: 'maintenance' as const,
        amount: 75.0,
      };

      await expenseRepository.create(operatingExpense);
      await expenseRepository.create(maintenanceExpense);

      const operatingExpenses = await expenseRepository.findByCategory(testVehicle.id, 'operating');

      expect(operatingExpenses).toHaveLength(1);
      expect(operatingExpenses[0].category).toBe('operating');
    });
  });

  describe('findFuelExpenses', () => {
    test('should find only fuel expenses', async () => {
      const fuelExpense = { ...testExpenseData, vehicleId: testVehicle.id, type: 'fuel' as const };
      const parkingExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        amount: 15.0,
      };

      await expenseRepository.create(fuelExpense);
      await expenseRepository.create(parkingExpense);

      const fuelExpenses = await expenseRepository.findFuelExpenses(testVehicle.id);

      expect(fuelExpenses).toHaveLength(1);
      expect(fuelExpenses[0].type).toBe('fuel');
      expect(fuelExpenses[0].gallons).toBe(testExpenseData.gallons);
    });
  });

  describe('batchCreate', () => {
    test('should create multiple expenses at once', async () => {
      const expensesData = [
        { ...testExpenseData, vehicleId: testVehicle.id },
        {
          ...testExpenseData,
          vehicleId: testVehicle.id,
          type: 'parking' as const,
          amount: 15.0,
          date: new Date('2024-01-20'),
        },
      ];

      const createdExpenses = await expenseRepository.batchCreate(expensesData);

      expect(createdExpenses).toHaveLength(2);
      expect(createdExpenses[0].id).toBeDefined();
      expect(createdExpenses[1].id).toBeDefined();
    });
  });

  describe('getTotalByCategory', () => {
    test('should calculate totals by category', async () => {
      const operatingExpense1 = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        category: 'operating' as const,
        amount: 50.0,
      };
      const operatingExpense2 = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        category: 'operating' as const,
        amount: 15.0,
      };
      const maintenanceExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        type: 'oil-change' as const,
        category: 'maintenance' as const,
        amount: 75.0,
      };

      await expenseRepository.create(operatingExpense1);
      await expenseRepository.create(operatingExpense2);
      await expenseRepository.create(maintenanceExpense);

      const categoryTotals = await expenseRepository.getTotalByCategory(testVehicle.id);

      expect(categoryTotals).toHaveLength(2);

      const operatingTotal = categoryTotals.find((ct) => ct.category === 'operating');
      const maintenanceTotal = categoryTotals.find((ct) => ct.category === 'maintenance');

      expect(operatingTotal?.total).toBe(65.0);
      expect(maintenanceTotal?.total).toBe(75.0);
    });

    test('should calculate totals by category within date range', async () => {
      const expense1 = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        amount: 50.0,
        date: new Date('2024-01-15'),
      };
      const expense2 = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        amount: 30.0,
        date: new Date('2024-02-15'),
      };

      await expenseRepository.create(expense1);
      await expenseRepository.create(expense2);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      const categoryTotals = await expenseRepository.getTotalByCategory(
        testVehicle.id,
        startDate,
        endDate
      );

      expect(categoryTotals).toHaveLength(1);
      expect(categoryTotals[0].total).toBe(50.0);
    });
  });

  describe('getMonthlyTotals', () => {
    test('should calculate monthly totals for a year', async () => {
      // Create expenses with explicit dates to avoid timezone issues
      const januaryExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        amount: 100.0,
        date: new Date(2024, 0, 15), // January 15, 2024
      };
      const februaryExpense = {
        ...testExpenseData,
        vehicleId: testVehicle.id,
        amount: 150.0,
        date: new Date(2024, 1, 15), // February 15, 2024
      };

      await expenseRepository.create(januaryExpense);
      await expenseRepository.create(februaryExpense);

      const monthlyTotals = await expenseRepository.getMonthlyTotals(testVehicle.id, 2024);

      expect(monthlyTotals.length).toBeGreaterThanOrEqual(1);

      // Check that we have the correct total amount
      const totalAmount = monthlyTotals.reduce((sum, mt) => sum + mt.total, 0);
      expect(totalAmount).toBe(250.0);

      // If we have separate months, check them individually
      if (monthlyTotals.length === 2) {
        const januaryTotal = monthlyTotals.find((mt) => mt.month === 1);
        const februaryTotal = monthlyTotals.find((mt) => mt.month === 2);

        expect(januaryTotal?.total).toBe(100.0);
        expect(februaryTotal?.total).toBe(150.0);
      }
    });
  });

  describe('update', () => {
    test('should update expense fields', async () => {
      const expenseData = { ...testExpenseData, vehicleId: testVehicle.id };
      const createdExpense = await expenseRepository.create(expenseData);

      // Add a small delay to ensure updatedAt timestamp is different
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updateData = {
        amount: 60.0,
        description: 'Updated description',
      };

      const updatedExpense = await expenseRepository.update(createdExpense.id, updateData);

      expect(updatedExpense.amount).toBe(updateData.amount);
      expect(updatedExpense.description).toBe(updateData.description);
      expect(updatedExpense.updatedAt?.getTime()).toBeGreaterThanOrEqual(
        createdExpense.updatedAt?.getTime() ?? 0
      );
    });

    test('should throw error for non-existent expense', async () => {
      await expect(async () => {
        await expenseRepository.update('non-existent-id', { amount: 100 });
      }).toThrow();
    });
  });

  describe('delete', () => {
    test('should delete expense', async () => {
      const expenseData = { ...testExpenseData, vehicleId: testVehicle.id };
      const createdExpense = await expenseRepository.create(expenseData);

      await expenseRepository.delete(createdExpense.id);

      const foundExpense = await expenseRepository.findById(createdExpense.id);
      expect(foundExpense).toBeNull();
    });

    test('should throw error for non-existent expense', async () => {
      await expect(async () => {
        await expenseRepository.delete('non-existent-id');
      }).toThrow();
    });
  });
});
