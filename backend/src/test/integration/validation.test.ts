import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  ValidationError,
  validateEmail,
  validatePositiveNumber,
  validateRequired,
  validateYear,
} from '../../lib/database.js';
import { repositoryFactory } from '../../lib/repositories/index.js';
import { clearTestData, setupTestDatabase, teardownTestDatabase } from '../setup.js';

describe('Data Validation Tests', () => {
  beforeAll(() => {
    setupTestDatabase();
  });

  beforeEach(() => {
    clearTestData();
  });

  afterAll(() => {
    teardownTestDatabase();
  });

  describe('Validation Utilities', () => {
    test('validateRequired should throw for empty values', () => {
      expect(() => validateRequired('', 'testField')).toThrow(ValidationError);
      expect(() => validateRequired(null, 'testField')).toThrow(ValidationError);
      expect(() => validateRequired(undefined, 'testField')).toThrow(ValidationError);
      expect(() => validateRequired('valid', 'testField')).not.toThrow();
    });

    test('validateEmail should validate email format', () => {
      expect(() => validateEmail('invalid-email')).toThrow(ValidationError);
      expect(() => validateEmail('test@')).toThrow(ValidationError);
      expect(() => validateEmail('@example.com')).toThrow(ValidationError);
      expect(() => validateEmail('test@example.com')).not.toThrow();
    });

    test('validatePositiveNumber should validate positive numbers', () => {
      expect(() => validatePositiveNumber(-1, 'amount')).toThrow(ValidationError);
      expect(() => validatePositiveNumber(0, 'amount')).toThrow(ValidationError);
      expect(() => validatePositiveNumber('invalid' as unknown as number, 'amount')).toThrow(
        ValidationError
      );
      expect(() => validatePositiveNumber(100, 'amount')).not.toThrow();
    });

    test('validateYear should validate reasonable years', () => {
      expect(() => validateYear(1800)).toThrow(ValidationError);
      expect(() => validateYear(2030)).toThrow(ValidationError);
      expect(() => validateYear(2020)).not.toThrow();
    });
  });

  describe('Database Constraint Tests', () => {
    test('should enforce unique email constraint', async () => {
      const userRepo = repositoryFactory.getUserRepository();

      const userData = {
        email: 'test@example.com',
        displayName: 'Test User',
        provider: 'google' as const,
        providerId: 'test-provider-123',
      };

      await userRepo.create(userData);

      // Should throw error for duplicate email
      await expect(async () => {
        await userRepo.create({
          ...userData,
          providerId: 'different-provider-id',
        });
      }).toThrow();
    });

    test('should enforce foreign key constraints', async () => {
      const vehicleRepo = repositoryFactory.getVehicleRepository();

      // Should throw error for non-existent user ID
      await expect(async () => {
        await vehicleRepo.create({
          userId: 'non-existent-user-id',
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
        });
      }).toThrow();
    });

    test('should cascade delete related records', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      const expenseRepo = repositoryFactory.getExpenseRepository();

      // Create user, vehicle, and expense
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

      await expenseRepo.create({
        vehicleId: vehicle.id,
        tags: JSON.stringify(['fuel']),
        category: 'fuel',
        amount: 50.0,
        currency: 'USD',
        date: new Date(),
      });

      // Delete user should cascade to vehicle and expenses
      await userRepo.delete(user.id);

      const foundVehicle = await vehicleRepo.findById(vehicle.id);
      expect(foundVehicle).toBeNull();

      const vehicleExpenses = await expenseRepo.findByVehicleId(vehicle.id);
      expect(vehicleExpenses).toHaveLength(0);
    });
  });

  describe('Data Integrity Tests', () => {
    test('should maintain referential integrity for expenses', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      const expenseRepo = repositoryFactory.getExpenseRepository();

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

      // Create multiple expenses
      await expenseRepo.create({
        vehicleId: vehicle.id,
        tags: JSON.stringify(['fuel']),
        category: 'fuel',
        amount: 50.0,
        currency: 'USD',
        date: new Date('2024-01-15'),
      });

      await expenseRepo.create({
        vehicleId: vehicle.id,
        tags: JSON.stringify(['maintenance']),
        category: 'maintenance',
        amount: 100.0,
        currency: 'USD',
        date: new Date('2024-01-20'),
      });

      // Verify expenses are linked to correct vehicle
      const vehicleExpenses = await expenseRepo.findByVehicleId(vehicle.id);
      expect(vehicleExpenses).toHaveLength(2);
      expect(vehicleExpenses.every((e) => e.vehicleId === vehicle.id)).toBe(true);

      // Verify user can access all their expenses
      const userExpenses = await expenseRepo.findByUserId(user.id);
      expect(userExpenses).toHaveLength(2);
    });

    test('should handle loan payment calculations correctly', async () => {
      const userRepo = repositoryFactory.getUserRepository();
      const vehicleRepo = repositoryFactory.getVehicleRepository();
      const loanRepo = repositoryFactory.getVehicleLoanRepository();
      const paymentRepo = repositoryFactory.getLoanPaymentRepository();

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

      const loan = await loanRepo.create({
        vehicleId: vehicle.id,
        lender: 'Test Bank',
        originalAmount: 20000,
        currentBalance: 20000,
        apr: 4.5,
        termMonths: 60,
        startDate: new Date('2020-03-15'),
        paymentAmount: 372.86,
        paymentFrequency: 'monthly',
        paymentDayOfMonth: 15,
      });

      // Create a payment record
      await paymentRepo.create({
        loanId: loan.id,
        paymentDate: new Date('2024-01-15'),
        paymentAmount: 372.86,
        principalAmount: 297.86,
        interestAmount: 75.0,
        remainingBalance: 19702.14,
        paymentNumber: 1,
        paymentType: 'standard',
        isScheduled: true,
      });

      // Verify payment was recorded
      const loanPayments = await paymentRepo.findByLoanId(loan.id);
      expect(loanPayments).toHaveLength(1);
      expect(loanPayments[0].remainingBalance).toBe(19702.14);

      const paymentCount = await paymentRepo.getPaymentCount(loan.id);
      expect(paymentCount).toBe(1);
    });
  });
});
