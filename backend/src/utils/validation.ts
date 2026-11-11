// Shared request validation. Route files import zValidator from here so every validation failure
// uses the app's error envelope.

import { zValidator as honoZValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodError, ZodType } from 'zod';
import { z } from 'zod';
import { financingRepository } from '../api/financing/repository';
import { insurancePolicyRepository } from '../api/insurance/repository';
import { type ReminderWithVehicles, reminderRepository } from '../api/reminders/repository';
import { tripRepository } from '../api/trips/repository';
import { vehicleRepository } from '../api/vehicles/repository';
import { CONFIG } from '../config';
import type { InsurancePolicy, Trip, Vehicle, VehicleFinancing } from '../db/schema';
import { isElectricFuelType } from '../db/types';
import { createErrorResponse, NotFoundError, ValidationError } from '../errors';

// The path is included so a multi-field failure names the field it refers to.
function describeIssue(issue: ZodError['issues'][number]): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

// Hono's default response has no code, and its message is a serialized Zod dump that the UI cannot
// show. details.issues keeps the per-field breakdown for forms.
export function zValidator<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema
) {
  return honoZValidator(target, schema, (result, c) => {
    if (result.success) return;
    const { issues } = result.error;
    return c.json(
      createErrorResponse(
        'ValidationError',
        issues.length === 1
          ? `Invalid ${target}: ${describeIssue(issues[0])}`
          : `Invalid ${target}: ${issues.map(describeIssue).join('; ')}`,
        { target, issues }
      ),
      400
    );
  });
}

// No defaults, and limit is capped at the runtime maxPageSize, so values match what clampPagination
// re-clamps. commonSchemas.pagination has defaults and a fixed max, so it would change clamping
// behavior.
const clampedPaginationFields = {
  limit: z.coerce.number().int().min(1).max(CONFIG.pagination.maxPageSize).optional(),
  offset: z.coerce.number().int().min(0).optional(),
} as const;

export const commonSchemas = {
  clampedPaginationFields,

  idParam: z.object({
    id: z.string().min(1, 'ID is required'),
  }),

  vehicleIdParam: z.object({
    vehicleId: z.string().min(1, 'Vehicle ID is required'),
  }),

  pagination: z.object({
    limit: z.coerce.number().int().positive().max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  }),
};

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

// There is deliberately no validateExpenseOwnership. An expense on a shared vehicle is stamped with
// the owner's userId, so a strict match would deny an editor their own row. Authorize expenses
// through the vehicle with requireVehicleRead/requireVehicleWrite (utils/sharing.ts).

export async function validateFinancingOwnership(
  financingId: string,
  userId: string
): Promise<VehicleFinancing> {
  const financing = await financingRepository.findById(financingId);
  if (!financing) {
    throw new NotFoundError('Financing');
  }

  const vehicle = await vehicleRepository.findByUserIdAndId(userId, financing.vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Financing');
  }

  return financing;
}

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

export async function validateReminderOwnership(
  reminderId: string,
  userId: string
): Promise<ReminderWithVehicles> {
  const reminder = await reminderRepository.findByIdAndUserId(reminderId, userId);
  if (!reminder) {
    throw new NotFoundError('Reminder');
  }
  return reminder;
}

// A foreign and an absent trip return the same 404, so the response does not reveal which exists.
export async function validateTripOwnership(tripId: string, userId: string): Promise<Trip> {
  const trip = await tripRepository.findByIdAndUserId(tripId, userId);
  if (!trip) {
    throw new NotFoundError('Trip');
  }
  return trip;
}

export function validateFuelExpenseData(
  category: string,
  mileage: number | null | undefined,
  volume: number | null | undefined,
  fuelType: string | null | undefined
): void {
  if (category === 'fuel') {
    if (!volume || !mileage) {
      if (isElectricFuelType(fuelType ?? null)) {
        throw new ValidationError('Charging expenses require charge amount (kWh) and mileage data');
      }
      throw new ValidationError('Fuel expenses require fuel amount and mileage data');
    }
  }
}

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
