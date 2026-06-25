import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { vehicleFinancing } from '../../db/schema';
import { changeTracker, requireAuth } from '../../middleware';
import {
  commonSchemas,
  validateFinancingOwnership,
  validateLoanTerms,
  validateVehicleOwnership,
} from '../../utils/validation';
import { deactivateFinancing } from './hooks';
import { financingRepository, withComputedBalance } from './repository';

const routes = new Hono();

// Validation schemas derived from db schema
const baseFinancingSchema = createInsertSchema(vehicleFinancing, {
  provider: z
    .string()
    .min(1, 'Provider is required')
    .max(
      CONFIG.validation.financing.providerMaxLength,
      `Provider must be ${CONFIG.validation.financing.providerMaxLength} characters or less`
    ),
  originalAmount: z.number().min(0.01, 'Original amount must be greater than 0'),
  apr: z
    .number()
    .min(0, 'APR cannot be negative')
    .max(
      CONFIG.validation.financing.maxApr,
      `APR cannot exceed ${CONFIG.validation.financing.maxApr}%`
    )
    .optional(),
  termMonths: z
    .number()
    .int()
    .min(1, 'Term must be at least 1 month')
    .max(
      CONFIG.validation.financing.maxTermMonths,
      `Term cannot exceed ${CONFIG.validation.financing.maxTermMonths} months`
    ),
  startDate: z.coerce.date(),
  paymentAmount: z.number().min(0.01, 'Payment amount must be greater than 0'),
  paymentDayOfMonth: z
    .number()
    .int()
    .min(CONFIG.validation.financing.minDayOfMonth)
    .max(CONFIG.validation.financing.maxDayOfMonth)
    .optional(),
  paymentDayOfWeek: z
    .number()
    .int()
    .min(CONFIG.validation.financing.minDayOfWeek)
    .max(CONFIG.validation.financing.maxDayOfWeek)
    .optional(),
  residualValue: z.number().min(0).optional(),
  mileageLimit: z.number().int().min(0).optional(),
  excessMileageFee: z.number().min(0).optional(),
});

const createFinancingSchema = baseFinancingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const financingParamsSchema = z.object({
  financingId: z.string().min(1, 'Financing ID is required'),
});

// Apply authentication and change tracking to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

/**
 * Helper: enrich a financing record with computed balance and payoff eligibility.
 */
async function enrichWithBalance(
  financing: NonNullable<Awaited<ReturnType<typeof financingRepository.findByVehicleId>>>
) {
  const computedBalance = await financingRepository.computeBalance(financing.id);
  return withComputedBalance(financing, computedBalance);
}

// GET /api/vehicles/:vehicleId/financing - Get financing details for a vehicle
routes.get(
  '/vehicles/:vehicleId/financing',
  zValidator('param', commonSchemas.vehicleIdParam),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    await validateVehicleOwnership(vehicleId, user.id);

    const financingData = await financingRepository.findByVehicleId(vehicleId);
    if (!financingData) {
      return c.json({
        success: true,
        data: null,
        message: 'No financing found for this vehicle',
      });
    }

    const enriched = await enrichWithBalance(financingData);
    return c.json({ success: true, data: enriched });
  }
);

// POST /api/vehicles/:vehicleId/financing - Create or update financing for a vehicle
routes.post(
  '/vehicles/:vehicleId/financing',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createFinancingSchema.omit({ vehicleId: true })),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const financingData = c.req.valid('json');

    await validateVehicleOwnership(vehicleId, user.id);

    if (financingData.financingType === 'loan' && financingData.apr !== undefined) {
      const validationErrors = validateLoanTerms({
        principal: financingData.originalAmount,
        apr: financingData.apr,
        termMonths: financingData.termMonths,
      });

      if (validationErrors.length > 0) {
        throw new HTTPException(400, {
          message: `Invalid loan terms: ${validationErrors.join(', ')}`,
          cause: validationErrors,
        });
      }
    }

    const existingFinancing = await financingRepository.findByVehicleId(vehicleId);

    if (existingFinancing) {
      // This endpoint is "the vehicle's financing is now THIS" — a create-or-replace. If the prior
      // financing was paid off / completed (isActive=false, via PUT /payoff or DELETE), re-financing
      // the same vehicle reuses that row, and `isActive` is .optional() in the create schema (it's a
      // .notNull().default(true) column, so drizzle-zod omits it) → the client never sends it → the
      // update would LEAVE isActive=false, silently dropping the new active financing from
      // the isActive-filtered queries (loanBreakdown/analytics) + the FE's isActive gate (#67). Re-activate
      // explicitly, mirroring how create() defaults isActive=true. A still-active record stays active
      // (idempotent). endDate is likewise cleared so a stale payoff/lease-end date can't linger.
      //
      // The cross-type optional fields must ALSO be reset, not merged (C293, the sibling defect to the
      // #67 reset). `update()` skips `undefined` keys, but these are all `.optional()` in the create
      // schema — so switching a vehicle's financing TYPE (lease↔loan) without re-sending the prior
      // type's fields would LEAVE them stale (a `loan` row carrying a lease `mileageLimit`, consumed by
      // FE lease-metrics + the Sheets export — NORTH_STAR #2). A fresh create() defaults each absent
      // nullable column to NULL; the create-or-REPLACE path must produce the same clean row. Coalesce
      // every optional cross-type/schedule field to null so the reused row mirrors a fresh insert.
      const updatedFinancing = await financingRepository.update(existingFinancing.id, {
        ...financingData,
        apr: financingData.apr ?? null,
        paymentDayOfMonth: financingData.paymentDayOfMonth ?? null,
        paymentDayOfWeek: financingData.paymentDayOfWeek ?? null,
        residualValue: financingData.residualValue ?? null,
        mileageLimit: financingData.mileageLimit ?? null,
        excessMileageFee: financingData.excessMileageFee ?? null,
        isActive: true,
        endDate: null,
      });
      return c.json({
        success: true,
        data: updatedFinancing,
        message: 'Financing updated successfully',
      });
    }

    const createdFinancing = await financingRepository.create({
      ...financingData,
      vehicleId,
    });
    return c.json(
      { success: true, data: createdFinancing, message: 'Financing created successfully' },
      201
    );
  }
);

// PATCH /api/financing/:financingId/payment-amount - Update scheduled payment amount
routes.patch(
  '/:financingId/payment-amount',
  zValidator('param', financingParamsSchema),
  zValidator(
    'json',
    z.object({
      paymentAmount: z.number().min(0.01, 'Payment amount must be greater than 0'),
    })
  ),
  async (c) => {
    const user = c.get('user');
    const { financingId } = c.req.valid('param');
    const { paymentAmount } = c.req.valid('json');
    await validateFinancingOwnership(financingId, user.id);

    const updated = await financingRepository.update(financingId, {
      paymentAmount,
      updatedAt: new Date(),
    });
    return c.json({
      success: true,
      data: updated,
      message: 'Payment amount updated successfully',
    });
  }
);

// PUT /api/financing/:financingId/payoff - Explicitly mark financing as paid off
routes.put('/:financingId/payoff', zValidator('param', financingParamsSchema), async (c) => {
  const user = c.get('user');
  const { financingId } = c.req.valid('param');
  await validateFinancingOwnership(financingId, user.id);

  const updated = await deactivateFinancing(financingId, user.id);

  return c.json({
    success: true,
    data: updated,
    message: 'Financing marked as paid off',
  });
});

// DELETE /api/financing/:financingId - Deactivate financing
routes.delete('/:financingId', zValidator('param', financingParamsSchema), async (c) => {
  const user = c.get('user');
  const { financingId } = c.req.valid('param');
  await validateFinancingOwnership(financingId, user.id);

  await deactivateFinancing(financingId, user.id);

  return c.json({ success: true, message: 'Financing marked as completed successfully' });
});

export { routes };
