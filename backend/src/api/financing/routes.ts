import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { vehicleFinancing } from '../../db/schema';
import { changeTracker, requireAuth } from '../../middleware';
import { financingWithBalanceToApi, moneyDollarsToCents } from '../../utils/money';
import {
  commonSchemas,
  validateFinancingOwnership,
  validateLoanTerms,
  validateVehicleOwnership,
  zValidator,
} from '../../utils/validation';
import { deactivateFinancing } from './hooks';
import { financingRepository, withComputedBalance } from './repository';

const routes = new Hono();

const baseFinancingSchema = createInsertSchema(vehicleFinancing, {
  provider: z
    .string()
    .min(1, 'Provider is required')
    .max(
      CONFIG.validation.financing.providerMaxLength,
      `Provider must be ${CONFIG.validation.financing.providerMaxLength} characters or less`
    ),
  // Client sends dollars; moneyDollarsToCents stores cents. The min bound applies to the dollar value.
  // apr is a percentage, not money.
  originalAmount: moneyDollarsToCents((n) => n.min(0.01, 'Original amount must be greater than 0')),
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
  paymentAmount: moneyDollarsToCents((n) => n.min(0.01, 'Payment amount must be greater than 0')),
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
  // mileageLimit is a mileage count, not money.
  residualValue: moneyDollarsToCents((n) => n.min(0)).optional(),
  mileageLimit: z.number().int().min(0).optional(),
  excessMileageFee: moneyDollarsToCents((n) => n.min(0)).optional(),
});

const createFinancingSchema = baseFinancingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const financingParamsSchema = z.object({
  financingId: z.string().min(1, 'Financing ID is required'),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

async function enrichWithBalance(
  financing: NonNullable<Awaited<ReturnType<typeof financingRepository.findByVehicleId>>>
) {
  const computedBalance = await financingRepository.computeBalance(financing.id);
  return withComputedBalance(financing, computedBalance);
}

// Same API shape as the vehicles route's embedded financing (utils/money.ts).
const financingRowToApi = financingWithBalanceToApi;

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
    return c.json({ success: true, data: financingRowToApi(enriched) });
  }
);

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
      // Reuses the vehicle's existing row. Reset what a fresh insert would default: update() skips
      // undefined keys, so isActive/endDate and the optional cross-type fields would otherwise keep
      // stale values from a previous financing.
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
        data: financingRowToApi(updatedFinancing),
        message: 'Financing updated successfully',
      });
    }

    const createdFinancing = await financingRepository.create({
      ...financingData,
      vehicleId,
    });
    return c.json(
      {
        success: true,
        data: financingRowToApi(createdFinancing),
        message: 'Financing created successfully',
      },
      201
    );
  }
);

routes.patch(
  '/:financingId/payment-amount',
  zValidator('param', financingParamsSchema),
  zValidator(
    'json',
    z.object({
      paymentAmount: moneyDollarsToCents((n) =>
        n.min(0.01, 'Payment amount must be greater than 0')
      ),
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
      data: financingRowToApi(updated),
      message: 'Payment amount updated successfully',
    });
  }
);

routes.put('/:financingId/payoff', zValidator('param', financingParamsSchema), async (c) => {
  const user = c.get('user');
  const { financingId } = c.req.valid('param');
  await validateFinancingOwnership(financingId, user.id);

  const updated = await deactivateFinancing(financingId, user.id);

  return c.json({
    success: true,
    data: financingRowToApi(updated),
    message: 'Financing marked as paid off',
  });
});

routes.delete('/:financingId', zValidator('param', financingParamsSchema), async (c) => {
  const user = c.get('user');
  const { financingId } = c.req.valid('param');
  await validateFinancingOwnership(financingId, user.id);

  await deactivateFinancing(financingId, user.id);

  return c.json({ success: true, message: 'Financing marked as completed successfully' });
});

export { routes };
