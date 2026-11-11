/**
 * Shared Validation Schemas
 *
 * Common validation schemas used across route handlers to avoid duplication.
 * These schemas can be composed and reused in different endpoints.
 *
 * Also the home of `zValidator` — route files import it from HERE, not from `@hono/zod-validator`,
 * so every validation failure answers in the same envelope as every other error. See below.
 */

import { zValidator as honoZValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodError, ZodType } from 'zod';
import { z } from 'zod';
import { CONFIG } from '../config';
import { createErrorResponse } from '../errors';

/**
 * One Zod issue rendered for a human: `body.date: Required`, or just `Required` at the root.
 * `path` is the only place the offending field is named, so dropping it would leave a message that
 * cannot be acted on when a schema has more than one field.
 */
function describeIssue(issue: ZodError['issues'][number]): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * `zValidator` that fails in the app's error envelope.
 *
 * Hono's own validator answers `{ success: false, error: { name: 'ZodError', message: <the issue
 * array, JSON-stringified> } }`. Two things are wrong with that for a client: there is no `code`,
 * which every other error on every other route carries and which the frontend switches on; and
 * `message` is a serialized dump of Zod internals, so a UI that surfaces `error.message` — as ours
 * does — shows the user a blob of JSON instead of a sentence.
 *
 * `details.issues` keeps the full per-field breakdown for a form that wants to highlight fields,
 * so nothing is lost by making `message` readable.
 */
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

/**
 * The raw `limit`/`offset` field validators for a list endpoint that pairs with `clampPagination`
 * (utils/pagination.ts). DISTINCT from `commonSchemas.pagination` below: this form is NO-DEFAULT +
 * caps `limit` at the runtime `CONFIG.pagination.maxPageSize` (not a hardcoded 100), exactly matching
 * what `clampPagination` re-clamps — so an out-of-range value is rejected at the boundary while an
 * omitted one falls through to `clampPagination`'s `defaultPageSize`. `commonSchemas.pagination`
 * instead bakes in `.default(50)`/`.default(0)` + a hardcoded `.max(100)`, which would CHANGE
 * clamp/default behavior if a clampPagination consumer adopted it. Spread into a
 * route's own `z.object({...})` so it can add endpoint-specific filters (e.g. vehicleId/purpose).
 */
const clampedPaginationFields = {
  limit: z.coerce.number().int().min(1).max(CONFIG.pagination.maxPageSize).optional(),
  offset: z.coerce.number().int().min(0).optional(),
} as const;

/**
 * Common validation schemas
 */
export const commonSchemas = {
  /**
   * Raw `limit`/`offset` fields for a `clampPagination`-backed list query — spread into a route's
   * `z.object({ ...commonSchemas.clampedPaginationFields, <filters> })`. See the note on
   * `clampedPaginationFields` for why this differs from `pagination` (no defaults; runtime max).
   */
  clampedPaginationFields,

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

import { financingRepository } from '../api/financing/repository';
import { insurancePolicyRepository } from '../api/insurance/repository';
import { type ReminderWithVehicles, reminderRepository } from '../api/reminders/repository';
import { tripRepository } from '../api/trips/repository';
import { vehicleRepository } from '../api/vehicles/repository';
import type { InsurancePolicy, Trip, Vehicle, VehicleFinancing } from '../db/schema';
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
 * Validate that EVERY vehicleId in a set belongs to the user (the plural, ValidationError-listing
 * counterpart to the single `validateVehicleOwnership`). Fetches the user's fleet once, then reports
 * all non-owned ids together. Used where a request attaches a list of vehicles (e.g. a reminder's
 * vehicleIds on create/update).
 * @throws ValidationError listing every id not found or not owned.
 */
export async function validateVehicleIdsOwned(
  vehicleIds: readonly string[],
  userId: string
): Promise<void> {
  const userVehicles = await vehicleRepository.findByUserId(userId);
  const ownedVehicleIds = new Set(userVehicles.map((v) => v.id));
  const invalidIds = vehicleIds.filter((id) => !ownedVehicleIds.has(id));
  if (invalidIds.length > 0) {
    throw new ValidationError(`Vehicles not found or not owned: ${invalidIds.join(', ')}`);
  }
}

/**
 * There is deliberately NO `validateExpenseOwnership` here. An expense on a shared vehicle is
 * OWNER-stamped (`expenses.userId` is the vehicle's owner, not the editor who wrote the row), so a
 * strict acting-user match denies an accepted editor their own row. Every expense surface —
 * including the receipt-photo gate — loads the row unscoped and authorizes on the vehicle through
 * `requireVehicleRead`/`requireVehicleWrite` in utils/sharing.ts, the one widening seam.
 */

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
 * Validate that a reminder belongs to the user, returning it (with its vehicleIds). The userId-scoped
 * counterpart to the inline `findByIdAndUserId` guard the reminder routes repeated 5×; mirrors the
 * validateExpenseOwnership shape (findByIdAndUserId → NotFoundError → return entity).
 * @throws NotFoundError if the reminder is not found or doesn't belong to the user
 */
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

/**
 * Validate that a trip belongs to the user, returning it (trips-location T2, the family). Trips own
 * via a userId column, so the repository's own userId-scoped read is the ownership check — mirrors the
 * validateReminderOwnership shape (findByIdAndUserId → NotFoundError → return entity). A NotFoundError
 * (never 403) keeps the enumeration-oracle discipline: a foreign or absent id is indistinguishable.
 * @throws NotFoundError if the trip is not found or doesn't belong to the user
 */
export async function validateTripOwnership(tripId: string, userId: string): Promise<Trip> {
  const trip = await tripRepository.findByIdAndUserId(tripId, userId);
  if (!trip) {
    throw new NotFoundError('Trip');
  }
  return trip;
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
