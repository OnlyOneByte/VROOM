import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { repositoryFactory } from '../../lib/repositories/index.js';
import { runMigrations, closeDatabaseConnection } from '../../db/connection.js';
import { clearDatabase } from '../../db/seed.js';
import { getCategoryForExpenseType } from '../../db/types.js';

describe('Repository Integration Tests', () => {
  beforeAll(async () => {
    // Initialize test database
    await runMigrations();
  });

  beforeEach(async () => {
    // Clear database before each test
    await clearDatabase();
  });

  afterAll(() => {
    // Close database connection
    closeDatabaseConnection();
  });

  describe('User Repository Integration', () => {
    test('should create and find user', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      
      const userData = {
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google' as const,
        providerId: 'test-provider-123',
      };

      const createdUser = await userRepo.create(userData);
      expect(createdUser.id).toBeDefined();
      expect(createdUser.email).toBe(userData.email);

      const foundUser = await userRepo.findByEmail(userData.email);
      expect(foundUser?.id).toBe(createdUser.id);
    });

    test('should update user Google refresh token', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      
      const user = await userRepo.create({
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'test-provider-123',
      });

      const token = 'new-refresh-token';
      const updatedUser = await userRepo.updateGoogleRefreshToken(user.id, token);
      
      expect(updatedUser.googleRefreshToken).toBe(token);
    });
  });

  describe('Vehicle Repository Integration', () => {
    test('should create vehicle and find by user', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      
      const user = await userRepo.create({
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'test-provider-123',
      });

      const vehicleData = {
        userId: user.id,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        licensePlate: 'TEST123',
      };

      const createdVehicle = await vehicleRepo.create(vehicleData);
      expect(createdVehicle.id).toBeDefined();
      expect(createdVehicle.make).toBe(vehicleData.make);

      const userVehicles = await vehicleRepo.findByUserId(user.id);
      expect(userVehicles).toHaveLength(1);
      expect(userVehicles[0].id).toBe(createdVehicle.id);
    });
  });

  describe('Expense Repository Integration', () => {
    test('should create expense and calculate analytics', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      const expenseRepo = repositoryFactory.getExpenseRepository();
      
      // Create user and vehicle
      const user = await userRepo.create({
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'test-provider-123',
      });

      const vehicle = await vehicleRepo.create({
        userId: user.id,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });

      // Create expenses
      const fuelExpense = await expenseRepo.create({
        vehicleId: vehicle.id,
        type: 'fuel',
        category: getCategoryForExpenseType('fuel'),
        amount: 50.00,
        currency: 'USD',
        date: new Date('2024-01-15'),
        gallons: 12.5,
      });

      const maintenanceExpense = await expenseRepo.create({
        vehicleId: vehicle.id,
        type: 'oil-change',
        category: getCategoryForExpenseType('oil-change'),
        amount: 75.00,
        currency: 'USD',
        date: new Date('2024-01-20'),
      });

      // Test finding expenses
      const vehicleExpenses = await expenseRepo.findByVehicleId(vehicle.id);
      expect(vehicleExpenses).toHaveLength(2);

      const fuelExpenses = await expenseRepo.findFuelExpenses(vehicle.id);
      expect(fuelExpenses).toHaveLength(1);
      expect(fuelExpenses[0].gallons).toBe(12.5);

      // Test analytics
      const categoryTotals = await expenseRepo.getTotalByCategory(vehicle.id);
      expect(categoryTotals).toHaveLength(2);
      
      const operatingTotal = categoryTotals.find(ct => ct.category === 'operating');
      const maintenanceTotal = categoryTotals.find(ct => ct.category === 'maintenance');
      
      expect(operatingTotal?.total).toBe(50.00);
      expect(maintenanceTotal?.total).toBe(75.00);
    });
  });

  describe('Loan Repository Integration', () => {
    test('should create and manage vehicle loan', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      const loanRepo = repositoryFactory.getVehicleLoanRepository();
      
      // Create user and vehicle
      const user = await userRepo.create({
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'test-provider-123',
      });

      const vehicle = await vehicleRepo.create({
        userId: user.id,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });

      // Create loan
      const loanData = {
        vehicleId: vehicle.id,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 15000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly' as const,
        paymentDayOfMonth: 15,
      };

      const createdLoan = await loanRepo.create(loanData);
      expect(createdLoan.id).toBeDefined();
      expect(createdLoan.currentBalance).toBe(15000);

      // Test finding loan
      const vehicleLoan = await loanRepo.findByVehicleId(vehicle.id);
      expect(vehicleLoan?.id).toBe(createdLoan.id);

      // Test updating balance
      const updatedLoan = await loanRepo.updateBalance(createdLoan.id, 14000);
      expect(updatedLoan.currentBalance).toBe(14000);
    });
  });

  describe('Insurance Repository Integration', () => {
    test('should create and manage insurance policy', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      const insuranceRepo = repositoryFactory.getInsurancePolicyRepository();
      
      // Create user and vehicle
      const user = await userRepo.create({
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google',
        providerId: 'test-provider-123',
      });

      const vehicle = await vehicleRepo.create({
        userId: user.id,
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
      });

      // Create insurance policy
      const insuranceData = {
        vehicleId: vehicle.id,
        company: 'Test Insurance Co',
        totalCost: 1200,
        termLengthMonths: 6,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-06-30'),
        monthlyCost: 200,
      };

      const createdPolicy = await insuranceRepo.create(insuranceData);
      expect(createdPolicy.id).toBeDefined();
      expect(createdPolicy.monthlyCost).toBe(200);

      // Test finding policies
      const vehiclePolicies = await insuranceRepo.findByVehicleId(vehicle.id);
      expect(vehiclePolicies).toHaveLength(1);
      expect(vehiclePolicies[0].id).toBe(createdPolicy.id);

      const activePolicy = await insuranceRepo.findActiveByVehicleId(vehicle.id);
      expect(activePolicy?.id).toBe(createdPolicy.id);
    });
  });
});