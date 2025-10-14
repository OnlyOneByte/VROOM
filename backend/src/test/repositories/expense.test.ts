import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ExpenseRepository } from '../../lib/repositories/expense.js';
import { VehicleRepository } from '../../lib/repositories/vehicle.js';
import { UserRepository } from '../../lib/repositories/user.js';
import { setupTestDatabase, teardownTestDatabase, testUserData, testVehicleData, testExpenseData } from '../setup.js';
import type { User, Vehicle, Expense } from '../../db/schema.js';

describe('ExpenseRepository', () => {
  let expenseRepository: ExpenseRepository;
  let vehicleRepository: VehicleRepository;
  let userRepository: UserRepository;
  let testDb: ReturnType<typeof setupTestDatabase>;
  let testUser: User;
  let testVehicle: Vehicle;

  beforeEach(async () => {
    testDb = setupTestDatabase();
    expenseRepository = new ExpenseRepository();
    vehicleRepository = new VehicleRepository();
    userRepository = new UserRepository();
    
    // Create test user and vehicle
    testUser = await userRepository.create(testUserData);
    testVehicle = await vehicleRepository.create({ ...testVehicleData, userId: testUser.id });
  });

  afterEach(() => {
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
        amount: 15.00,
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
        amount: 20.00,
        date: new Date('2024-01-20')
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
        date: new Date('2024-01-10')
      };
      const expense2Data = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        amount: 20.00,
        date: new Date('2024-01-20')
      };
      const expense3Data = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        type: 'tolls' as const,
        amount: 5.00,
        date: new Date('2024-02-05')
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
      expect(expensesInRange.every(e => e.date >= startDate && e.date <= endDate)).toBe(true);
    });
  });

  describe('findByType', () => {
    test('should find expenses by type', async () => {
      const fuelExpense = { ...testExpenseData, vehicleId: testVehicle.id, type: 'fuel' as const };
      const parkingExpense = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id, 
        type: 'parking' as const,
        amount: 15.00
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
        category: 'operating' as const 
      };
      const maintenanceExpense = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        type: 'oil-change' as const,
        category: 'maintenance' as const,
        amount: 75.00
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
        amount: 15.00
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
          amount: 15.00,
          date: new Date('2024-01-20')
        }
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
        amount: 50.00
      };
      const operatingExpense2 = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        type: 'parking' as const,
        category: 'operating' as const,
        amount: 15.00
      };
      const maintenanceExpense = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        type: 'oil-change' as const,
        category: 'maintenance' as const,
        amount: 75.00
      };

      await expenseRepository.create(operatingExpense1);
      await expenseRepository.create(operatingExpense2);
      await expenseRepository.create(maintenanceExpense);

      const categoryTotals = await expenseRepository.getTotalByCategory(testVehicle.id);

      expect(categoryTotals).toHaveLength(2);
      
      const operatingTotal = categoryTotals.find(ct => ct.category === 'operating');
      const maintenanceTotal = categoryTotals.find(ct => ct.category === 'maintenance');
      
      expect(operatingTotal?.total).toBe(65.00);
      expect(maintenanceTotal?.total).toBe(75.00);
    });

    test('should calculate totals by category within date range', async () => {
      const expense1 = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        amount: 50.00,
        date: new Date('2024-01-15')
      };
      const expense2 = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        amount: 30.00,
        date: new Date('2024-02-15')
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
      expect(categoryTotals[0].total).toBe(50.00);
    });
  });

  describe('getMonthlyTotals', () => {
    test('should calculate monthly totals for a year', async () => {
      const januaryExpense = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        amount: 100.00,
        date: new Date('2024-01-15')
      };
      const februaryExpense = { 
        ...testExpenseData, 
        vehicleId: testVehicle.id,
        amount: 150.00,
        date: new Date('2024-02-15')
      };

      await expenseRepository.create(januaryExpense);
      await expenseRepository.create(februaryExpense);

      const monthlyTotals = await expenseRepository.getMonthlyTotals(testVehicle.id, 2024);

      expect(monthlyTotals).toHaveLength(2);
      
      const januaryTotal = monthlyTotals.find(mt => mt.month === 1);
      const februaryTotal = monthlyTotals.find(mt => mt.month === 2);
      
      expect(januaryTotal?.total).toBe(100.00);
      expect(februaryTotal?.total).toBe(150.00);
    });
  });

  describe('update', () => {
    test('should update expense fields', async () => {
      const expenseData = { ...testExpenseData, vehicleId: testVehicle.id };
      const createdExpense = await expenseRepository.create(expenseData);
      
      const updateData = {
        amount: 60.00,
        description: 'Updated description',
      };

      const updatedExpense = await expenseRepository.update(createdExpense.id, updateData);

      expect(updatedExpense.amount).toBe(updateData.amount);
      expect(updatedExpense.description).toBe(updateData.description);
      expect(updatedExpense.updatedAt.getTime()).toBeGreaterThan(createdExpense.updatedAt.getTime());
    });

    test('should throw error for non-existent expense', async () => {
      expect(async () => {
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
      expect(async () => {
        await expenseRepository.delete('non-existent-id');
      }).toThrow();
    });
  });
});