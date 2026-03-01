import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { vehicleFinancing, vehicleFinancingPayments } from '../../db/schema';
import { changeTracker, requireAuth } from '../../middleware';
import {
  commonSchemas,
  validateFinancingOwnership,
  validateLoanTerms,
} from '../../utils/validation';
import { vehicleRepository } from '../vehicles/repository';
import { financingRepository } from './repository';

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
  currentBalance: true,
  createdAt: true,
  updatedAt: true,
});

const basePaymentSchema = createInsertSchema(vehicleFinancingPayments, {
  paymentAmount: z.number().min(0.01, 'Payment amount must be greater than 0'),
  paymentDate: z.coerce.date(),
});

const financingPaymentSchema = basePaymentSchema.omit({
  id: true,
  financingId: true,
  principalAmount: true,
  interestAmount: true,
  remainingBalance: true,
  paymentNumber: true,
  createdAt: true,
  updatedAt: true,
});

const financingParamsSchema = z.object({
  financingId: z.string().min(1, 'Financing ID is required'),
});

// Apply authentication and change tracking to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// GET /api/vehicles/:vehicleId/financing - Get financing details for a vehicle
routes.get(
  '/vehicles/:vehicleId/financing',
  zValidator('param', commonSchemas.vehicleIdParam),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }

    const financingData = await financingRepository.findByVehicleId(vehicleId);
    return c.json({
      success: true,
      data: financingData || null,
      message: financingData ? undefined : 'No financing found for this vehicle',
    });
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

    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }

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
      const updatedFinancing = await financingRepository.update(existingFinancing.id, {
        ...financingData,
        currentBalance: financingData.originalAmount,
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
      currentBalance: financingData.originalAmount,
    });
    return c.json(
      { success: true, data: createdFinancing, message: 'Financing created successfully' },
      201
    );
  }
);

// POST /api/financing/:financingId/payment - Record a financing payment
routes.post(
  '/:financingId/payment',
  zValidator('param', financingParamsSchema),
  zValidator('json', financingPaymentSchema),
  async (c) => {
    const user = c.get('user');
    const { financingId } = c.req.valid('param');
    const paymentData = c.req.valid('json');

    const financingRecord = await validateFinancingOwnership(financingId, user.id);

    if (!financingRecord.isActive) {
      throw new HTTPException(400, { message: 'Cannot add payment to inactive financing' });
    }

    const paymentCount = await financingRepository.getPaymentCount(financingId);
    const principalAmount = paymentData.paymentAmount;
    const remainingBalance = Math.max(0, financingRecord.currentBalance - principalAmount);

    const newPayment = {
      financingId,
      paymentDate: paymentData.paymentDate,
      paymentAmount: paymentData.paymentAmount,
      principalAmount,
      interestAmount: 0,
      remainingBalance,
      paymentNumber: paymentCount + 1,
      paymentType: paymentData.paymentType,
      isScheduled: false,
    };

    const createdPayment = await financingRepository.createPayment(newPayment);
    const updatedFinancing = await financingRepository.updateBalance(financingId, remainingBalance);

    if (remainingBalance <= 0.01) {
      await financingRepository.markAsCompleted(financingId, paymentData.paymentDate);
    }

    return c.json(
      {
        success: true,
        data: { payment: createdPayment, financing: updatedFinancing },
        message: 'Payment recorded successfully',
      },
      201
    );
  }
);

// GET /api/financing/:financingId/payments - Get payment history
routes.get('/:financingId/payments', zValidator('param', financingParamsSchema), async (c) => {
  const user = c.get('user');
  const { financingId } = c.req.valid('param');
  const financingRecord = await validateFinancingOwnership(financingId, user.id);
  const payments = await financingRepository.findPaymentsByFinancingId(financingId);
  return c.json({
    success: true,
    data: { financing: financingRecord, payments, paymentCount: payments.length },
  });
});

// DELETE /api/financing/:financingId - Delete financing (mark as completed)
routes.delete('/:financingId', zValidator('param', financingParamsSchema), async (c) => {
  const user = c.get('user');
  const { financingId } = c.req.valid('param');
  await validateFinancingOwnership(financingId, user.id);
  await financingRepository.markAsCompleted(financingId, new Date());
  return c.json({ success: true, message: 'Financing marked as completed successfully' });
});

export { routes };
