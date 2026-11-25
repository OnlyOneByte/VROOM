import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { type AppContext, repos } from '../../app-context';
import { CONFIG } from '../../config';
import { vehicleFinancing } from '../../db/schema';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, type ResourceOf, vehicleParam } from '../../permissions/authorize';
import {
  boundedDollarsToCents,
  financingWithBalanceToApi,
  formatNumberForMessage,
} from '../../utils/money';
import { isValidTimeZone } from '../../utils/time-zone';
import {
  commonSchemas,
  dateInput,
  MAX_ODOMETER_READING,
  WHOLE_DISTANCE_MESSAGE,
  zValidator,
} from '../../utils/validation';
import { deactivateFinancing } from './hooks';
import { withComputedBalance } from './repository';

const routes = new Hono();

const FINANCING_TYPES = ['loan', 'lease', 'own'] as const;
const PAYMENT_FREQUENCIES = ['monthly', 'bi-weekly', 'weekly', 'custom'] as const;

const fin = CONFIG.validation.financing;
const MILEAGE_LIMIT_TOO_HIGH_MESSAGE = `Mileage limit must be ${formatNumberForMessage(MAX_ODOMETER_READING)} or less`;

const paymentAmountSchema = boundedDollarsToCents(
  'Payment amount',
  CONFIG.validation.expense.maxAmount,
  (n) => n.min(0.01, 'Payment amount must be greater than 0')
);

const baseFinancingSchema = createInsertSchema(vehicleFinancing, {
  financingType: z.enum(FINANCING_TYPES).optional(),
  paymentFrequency: z.enum(PAYMENT_FREQUENCIES).optional(),
  provider: z
    .string()
    .min(1, 'Provider is required')
    .max(
      CONFIG.validation.financing.providerMaxLength,
      `Provider must be ${CONFIG.validation.financing.providerMaxLength} characters or less`
    ),
  originalAmount: boundedDollarsToCents('Original amount', fin.maxOriginalAmount, (n) =>
    n.min(0.01, 'Original amount must be greater than 0')
  ),
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
  startDate: dateInput,
  paymentAmount: paymentAmountSchema,
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
  residualValue: boundedDollarsToCents('Residual value', fin.maxResidualValue, (n) =>
    n.min(0)
  ).optional(),
  mileageLimit: z
    .number()
    .int(WHOLE_DISTANCE_MESSAGE)
    .min(0)
    .max(MAX_ODOMETER_READING, MILEAGE_LIMIT_TOO_HIGH_MESSAGE)
    .optional(),
  excessMileageFee: boundedDollarsToCents('Excess mileage fee', fin.maxExcessMileageFee, (n) =>
    n.min(0)
  ).optional(),
});

const createFinancingSchema = baseFinancingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const timeZoneQuerySchema = z.object({
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
});

const financingParamsSchema = z.object({
  financingId: z.string().min(1, 'Financing ID is required'),
});

const fromFinancing: ResourceOf = async (c) => {
  const financing = await repos().financing.findById(c.req.param('financingId') ?? '');
  if (!financing) throw new NotFoundError('Financing');
  return { kind: 'vehicle', vehicleId: financing.vehicleId };
};

async function financingOwner(financingId: string): Promise<string> {
  const financing = await repos().financing.findById(financingId);
  if (!financing) throw new NotFoundError('Financing');
  const owner = await repos().vehicles.findById(financing.vehicleId);
  if (!owner) throw new NotFoundError('Financing');
  return owner.userId;
}

routes.use('*', requireAuth);
routes.use('*', changeTracker);

async function enrichWithBalance(
  financing: NonNullable<Awaited<ReturnType<AppContext['repos']['financing']['findByVehicleId']>>>,
  timeZone?: string
) {
  const computedBalance = await repos().financing.computeBalance(financing.id, timeZone);
  return withComputedBalance(financing, computedBalance);
}

const financingRowToApi = financingWithBalanceToApi;

routes.get(
  '/vehicles/:vehicleId/financing',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', timeZoneQuerySchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    const { timeZone } = c.req.valid('query');

    const financingData = await repos().financing.findByVehicleId(vehicleId);
    if (!financingData) {
      return c.json({
        success: true,
        data: null,
        message: 'No financing found for this vehicle',
      });
    }

    const enriched = await enrichWithBalance(financingData, timeZone);
    return c.json({ success: true, data: financingRowToApi(enriched) });
  }
);

routes.post(
  '/vehicles/:vehicleId/financing',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createFinancingSchema.omit({ vehicleId: true })),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const { vehicleId } = c.req.valid('param');
    const financingData = c.req.valid('json');

    const existingFinancing = await repos().financing.findByVehicleId(vehicleId);

    if (existingFinancing) {
      // update() skips undefined keys, so every reset field must be set to null explicitly.
      const updatedFinancing = await repos().financing.update(existingFinancing.id, {
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

    const createdFinancing = await repos().financing.create({
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
      paymentAmount: paymentAmountSchema,
    })
  ),
  authorize(fromFinancing),
  async (c) => {
    const { financingId } = c.req.valid('param');
    const { paymentAmount } = c.req.valid('json');

    const updated = await repos().financing.update(financingId, {
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

routes.put(
  '/:financingId/payoff',
  zValidator('param', financingParamsSchema),
  authorize(fromFinancing),
  async (c) => {
    const { financingId } = c.req.valid('param');

    const updated = await deactivateFinancing(financingId, await financingOwner(financingId));

    return c.json({
      success: true,
      data: financingRowToApi(updated),
      message: 'Financing marked as paid off',
    });
  }
);

routes.delete(
  '/:financingId',
  zValidator('param', financingParamsSchema),
  authorize(fromFinancing),
  async (c) => {
    const { financingId } = c.req.valid('param');

    await deactivateFinancing(financingId, await financingOwner(financingId));

    return c.json({ success: true, message: 'Financing marked as completed successfully' });
  }
);

export { routes };
