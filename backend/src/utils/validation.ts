/**
 * Shared Validation Schemas
 *
 * Common validation schemas used across route handlers to avoid duplication.
 * These schemas can be composed and reused in different endpoints.
 */

import { z } from 'zod';

/**
 * Reusable validator functions for common patterns
 */
export const validators = {
  /**
   * Required string with max length
   */
  requiredString: (name: string, maxLength: number) =>
    z
      .string()
      .min(1, `${name} is required`)
      .max(maxLength, `${name} must be ${maxLength} characters or less`),

  /**
   * Optional string with max length
   */
  optionalString: (maxLength: number) => z.string().max(maxLength).optional(),

  /**
   * Positive number (greater than 0)
   */
  positiveNumber: z.number().positive('Must be greater than 0'),

  /**
   * Non-negative integer (0 or greater)
   */
  nonNegativeInt: z.number().int().min(0, 'Must be 0 or greater'),

  /**
   * Positive integer (greater than 0)
   */
  positiveInt: z.number().int().positive('Must be a positive integer'),

  /**
   * Date string that coerces to Date
   */
  dateString: z.coerce.date(),

  /**
   * Optional URL
   */
  optionalUrl: z.string().url({ message: 'Invalid URL format' }).optional(),

  /**
   * Email address
   */
  email: z.string().email({ message: 'Invalid email address' }),

  /**
   * Percentage (0-100)
   */
  percentage: z.number().min(0, 'Must be at least 0').max(100, 'Must be at most 100'),
};

/**
 * Common validation schemas
 */
export const commonSchemas = {
  /**
   * Generic ID validation
   */
  id: z.string().min(1, 'ID is required'),

  /**
   * Parameter schema for routes with :id param
   * Usage: zValidator('param', commonSchemas.idParam)
   */
  idParam: z.object({
    id: z.string().min(1, 'ID is required'),
  }),

  /**
   * Parameter schema for routes with :vehicleId param
   * Usage: zValidator('param', commonSchemas.vehicleIdParam)
   */
  vehicleIdParam: z.object({
    vehicleId: z.string().min(1, 'Vehicle ID is required'),
  }),

  /**
   * Pagination query parameters
   * Usage: zValidator('query', commonSchemas.pagination)
   */
  pagination: z.object({
    limit: z.coerce.number().int().positive().max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),

  /**
   * Date range query parameters
   * Usage: zValidator('query', commonSchemas.dateRange)
   */
  dateRange: z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),

  /**
   * Combined pagination and date range
   * Usage: zValidator('query', commonSchemas.paginatedDateRange)
   */
  paginatedDateRange: z.object({
    limit: z.coerce.number().int().positive().max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
};

/**
 * Ownership Validation Helpers
 *
 * These functions validate that resources belong to the authenticated user.
 * They throw HTTPException if the resource is not found or doesn't belong to the user.
 */

import { expenseRepository } from '../api/expenses/repository';
import { financingRepository } from '../api/financing/repository';
import { insurancePolicyRepository } from '../api/insurance/repository';
import { vehicleRepository } from '../api/vehicles/repository';
import type { Expense, InsurancePolicy, Vehicle, VehicleFinancing } from '../db/schema';
import { NotFoundError } from '../errors';

/**
 * Validate that a vehicle belongs to the user
 * @throws NotFoundError if vehicle not found or doesn't belong to user
 */
export async function validateVehicleOwnership(
  vehicleId: string,
  userId: string
): Promise<Vehicle> {
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }
  return vehicle;
}

/**
 * Validate that an expense belongs to the user (via direct userId column)
 * @throws NotFoundError if expense not found or doesn't belong to user
 */
export async function validateExpenseOwnership(
  expenseId: string,
  userId: string
): Promise<Expense> {
  const expense = await expenseRepository.findByIdAndUserId(expenseId, userId);
  if (!expense) {
    throw new NotFoundError('Expense');
  }
  return expense;
}

/**
 * Validate that financing belongs to the user (via vehicle ownership)
 * @throws NotFoundError if financing not found or doesn't belong to user
 */
export async function validateFinancingOwnership(
  financingId: string,
  userId: string
): Promise<VehicleFinancing> {
  const financing = await financingRepository.findById(financingId);
  if (!financing) {
    throw new NotFoundError('Financing');
  }

  // Verify the financing's vehicle belongs to the user
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, financing.vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Financing');
  }

  return financing;
}

/**
 * Validate that insurance policy belongs to the user (via userId column)
 * @throws NotFoundError if insurance not found or doesn't belong to user
 */
export async function validateInsuranceOwnership(
  insuranceId: string,
  userId: string
): Promise<InsurancePolicy> {
  const insurance = await insurancePolicyRepository.findById(insuranceId);
  if (!insurance) {
    throw new NotFoundError('Insurance policy');
  }

  if (insurance.userId !== userId) {
    throw new NotFoundError('Insurance policy');
  }

  return insurance;
}

/**
 * Shared Validation Logic
 */

import { isElectricFuelType } from '../db/types';
import { ValidationError } from '../errors';

/**
 * Validate fuel expense requirements
 * Fuel expenses must have both fuelAmount and mileage data.
 * Error messages differ based on fuelType (electric vs fuel terminology).
 */
export function validateFuelExpenseData(
  category: string,
  mileage: number | null | undefined,
  fuelAmount: number | null | undefined,
  fuelType: string | null | undefined
): void {
  if (category === 'fuel') {
    if (!fuelAmount || !mileage) {
      if (isElectricFuelType(fuelType ?? null)) {
        throw new ValidationError('Charging expenses require charge amount (kWh) and mileage data');
      }
      throw new ValidationError('Fuel expenses require fuel amount and mileage data');
    }
  }
}

/**
 * Validate loan terms
 */
export function validateLoanTerms(terms: {
  principal: number;
  apr: number;
  termMonths: number;
}): string[] {
  const errors: string[] = [];
  if (terms.principal <= 0) errors.push('Principal must be greater than 0');
  if (terms.apr < 0 || terms.apr > 100) errors.push('APR must be between 0 and 100');
  if (terms.termMonths <= 0) errors.push('Term must be at least 1 month');
  return errors;
}
