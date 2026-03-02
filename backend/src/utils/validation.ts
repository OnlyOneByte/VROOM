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

import { HTTPException } from 'hono/http-exception';
import { expenseRepository } from '../api/expenses/repository';
import { financingRepository } from '../api/financing/repository';
import { insurancePolicyRepository } from '../api/insurance/repository';
import { vehicleRepository } from '../api/vehicles/repository';
import type { Expense, InsurancePolicy, Vehicle, VehicleFinancing } from '../db/schema';

/**
 * Validate that a vehicle belongs to the user
 * @throws HTTPException(404) if vehicle not found or doesn't belong to user
 */
export async function validateVehicleOwnership(
  vehicleId: string,
  userId: string
): Promise<Vehicle> {
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, vehicleId);
  if (!vehicle) {
    throw new HTTPException(404, { message: 'Vehicle not found' });
  }
  return vehicle;
}

/**
 * Validate that an expense belongs to the user (via vehicle ownership)
 * @throws HTTPException(404) if expense not found or doesn't belong to user
 */
export async function validateExpenseOwnership(
  expenseId: string,
  userId: string
): Promise<Expense> {
  const expense = await expenseRepository.findById(expenseId);
  if (!expense) {
    throw new HTTPException(404, { message: 'Expense not found' });
  }

  // Verify the expense's vehicle belongs to the user
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, expense.vehicleId);
  if (!vehicle) {
    throw new HTTPException(404, { message: 'Expense not found' });
  }

  return expense;
}

/**
 * Validate that financing belongs to the user (via vehicle ownership)
 * @throws HTTPException(404) if financing not found or doesn't belong to user
 */
export async function validateFinancingOwnership(
  financingId: string,
  userId: string
): Promise<VehicleFinancing> {
  const financing = await financingRepository.findById(financingId);
  if (!financing) {
    throw new HTTPException(404, { message: 'Financing not found' });
  }

  // Verify the financing's vehicle belongs to the user
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, financing.vehicleId);
  if (!vehicle) {
    throw new HTTPException(404, { message: 'Financing not found' });
  }

  return financing;
}

/**
 * Validate that insurance policy belongs to the user (via junction table → vehicle ownership)
 * @throws HTTPException(404) if insurance not found or doesn't belong to user
 */
export async function validateInsuranceOwnership(
  insuranceId: string,
  userId: string
): Promise<InsurancePolicy> {
  const insurance = await insurancePolicyRepository.findById(insuranceId);
  if (!insurance) {
    throw new HTTPException(404, { message: 'Insurance policy not found' });
  }

  // Verify the user owns at least one vehicle linked to this policy via junction table
  const vehicleIds = await insurancePolicyRepository.getVehicleIds(insuranceId);
  let ownsLinkedVehicle = false;
  for (const vid of vehicleIds) {
    const vehicle = await vehicleRepository.findByUserIdAndId(userId, vid);
    if (vehicle) {
      ownsLinkedVehicle = true;
      break;
    }
  }

  if (!ownsLinkedVehicle) {
    throw new HTTPException(404, { message: 'Insurance policy not found' });
  }

  return insurance;
}

/**
 * Shared Validation Logic
 */

import { ValidationError } from '../errors';

/**
 * Validate fuel expense requirements
 * Fuel expenses must have both fuelAmount and mileage data
 */
export function validateFuelExpenseData(
  category: string,
  mileage: number | null | undefined,
  fuelAmount: number | null | undefined
): void {
  if (category === 'fuel') {
    if (!fuelAmount || !mileage) {
      throw new ValidationError('Fuel expenses require fuelAmount and mileage data');
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
