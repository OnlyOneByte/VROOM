import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { NewVehicleFinancing, NewVehicleFinancingPayment } from '../db/schema';
import {
  calculatePaymentBreakdown,
  generateAmortizationSchedule,
  type LoanTerms,
  validateLoanTerms,
} from '../lib/loan-calculator';
import { requireAuth } from '../lib/middleware/auth';
import { trackDataChanges } from '../lib/middleware/change-tracker';
import { repositoryFactory } from '../lib/repositories/factory';

const financing = new Hono();

// Validation schemas
const createFinancingSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
  financingType: z.enum(['loan', 'lease', 'own']).default('loan'),
  provider: z
    .string()
    .min(1, 'Provider is required')
    .max(100, 'Provider must be 100 characters or less'),
  originalAmount: z.number().min(0.01, 'Original amount must be greater than 0'),
  apr: z.number().min(0, 'APR cannot be negative').max(50, 'APR cannot exceed 50%').optional(),
  termMonths: z
    .number()
    .int()
    .min(1, 'Term must be at least 1 month')
    .max(600, 'Term cannot exceed 600 months'),
  startDate: z
    .string()
    .datetime()
    .transform((val) => new Date(val)),
  paymentAmount: z.number().min(0.01, 'Payment amount must be greater than 0'),
  paymentFrequency: z.enum(['monthly', 'bi-weekly', 'weekly']).default('monthly'),
  paymentDayOfMonth: z.number().int().min(1).max(31).optional(),
  paymentDayOfWeek: z.number().int().min(0).max(6).optional(),
  // Lease-specific fields
  residualValue: z.number().min(0).optional(),
  mileageLimit: z.number().int().min(0).optional(),
  excessMileageFee: z.number().min(0).optional(),
});

const financingPaymentSchema = z.object({
  paymentAmount: z.number().min(0.01, 'Payment amount must be greater than 0'),
  paymentDate: z
    .string()
    .datetime()
    .transform((val) => new Date(val)),
  paymentType: z.enum(['standard', 'extra', 'custom-split']).default('standard'),
});

const financingParamsSchema = z.object({
  financingId: z.string().min(1, 'Financing ID is required'),
});

const vehicleParamsSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
});

// Apply authentication and change tracking to all routes
financing.use('*', requireAuth);
financing.use('*', trackDataChanges);

// GET /api/vehicles/:vehicleId/financing - Get financing details for a vehicle
financing.get(
  '/vehicles/:vehicleId/financing',
  zValidator('param', vehicleParamsSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { vehicleId } = c.req.valid('param');

      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const financingRepository = repositoryFactory.getVehicleFinancingRepository();

      // Verify vehicle belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }

      const financingData = await financingRepository.findByVehicleId(vehicleId);

      if (!financingData) {
        return c.json({
          success: true,
          data: null,
          message: 'No financing found for this vehicle',
        });
      }

      return c.json({
        success: true,
        data: financingData,
      });
    } catch (error) {
      console.error('Error fetching vehicle financing:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to fetch vehicle financing' });
    }
  }
);

// POST /api/vehicles/:vehicleId/financing - Create or update financing for a vehicle
financing.post(
  '/vehicles/:vehicleId/financing',
  zValidator('param', vehicleParamsSchema),
  zValidator('json', createFinancingSchema.omit({ vehicleId: true })),
  async (c) => {
    try {
      const user = c.get('user');
      const { vehicleId } = c.req.valid('param');
      const financingData = c.req.valid('json');

      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const financingRepository = repositoryFactory.getVehicleFinancingRepository();

      // Verify vehicle belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }

      // Validate loan terms if it's a loan
      if (financingData.financingType === 'loan' && financingData.apr !== undefined) {
        const loanTerms: LoanTerms = {
          principal: financingData.originalAmount,
          apr: financingData.apr,
          termMonths: financingData.termMonths,
          startDate: financingData.startDate,
        };

        const validationErrors = validateLoanTerms(loanTerms);
        if (validationErrors.length > 0) {
          console.error('Loan validation errors:', validationErrors);
          console.error('Loan terms:', loanTerms);
          throw new HTTPException(400, {
            message: `Invalid loan terms: ${validationErrors.join(', ')}`,
            cause: validationErrors,
          });
        }
      }

      // Check if financing already exists for this vehicle
      const existingFinancing = await financingRepository.findByVehicleId(vehicleId);

      if (existingFinancing) {
        // Update existing financing
        const updatedFinancing = await financingRepository.update(existingFinancing.id, {
          ...financingData,
          currentBalance: financingData.originalAmount, // Reset balance when updating terms
        });

        return c.json({
          success: true,
          data: updatedFinancing,
          message: 'Financing updated successfully',
        });
      } else {
        // Create new financing
        const newFinancing: NewVehicleFinancing = {
          ...financingData,
          vehicleId,
          currentBalance: financingData.originalAmount,
        };

        const createdFinancing = await financingRepository.create(newFinancing);

        return c.json(
          {
            success: true,
            data: createdFinancing,
            message: 'Financing created successfully',
          },
          201
        );
      }
    } catch (error) {
      console.error('Error creating/updating vehicle financing:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to create/update vehicle financing' });
    }
  }
);

// GET /api/financing/:financingId/schedule - Get amortization schedule (for loans)
financing.get('/:financingId/schedule', zValidator('param', financingParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { financingId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const financingRepository = repositoryFactory.getVehicleFinancingRepository();

    const financingData = await financingRepository.findById(financingId);
    if (!financingData) {
      throw new HTTPException(404, { message: 'Financing not found' });
    }

    // Verify financing belongs to user's vehicle
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, financingData.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Financing not found' });
    }

    // Only generate amortization schedule for loans
    if (financingData.financingType !== 'loan' || !financingData.apr) {
      throw new HTTPException(400, { message: 'Amortization schedule only available for loans' });
    }

    const loanTerms: LoanTerms = {
      principal: financingData.originalAmount,
      apr: financingData.apr,
      termMonths: financingData.termMonths,
      startDate: financingData.startDate,
    };

    const analysis = generateAmortizationSchedule(loanTerms);

    return c.json({
      success: true,
      data: {
        financing: financingData,
        analysis,
        schedule: analysis.schedule,
      },
    });
  } catch (error) {
    console.error('Error generating amortization schedule:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to generate amortization schedule' });
  }
});

// POST /api/financing/:financingId/payment - Record a financing payment
financing.post(
  '/:financingId/payment',
  zValidator('param', financingParamsSchema),
  zValidator('json', financingPaymentSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { financingId } = c.req.valid('param');
      const paymentData = c.req.valid('json');

      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const financingRepository = repositoryFactory.getVehicleFinancingRepository();
      const paymentRepository = repositoryFactory.getVehicleFinancingPaymentRepository();

      const financingRecord = await financingRepository.findById(financingId);
      if (!financingRecord) {
        throw new HTTPException(404, { message: 'Financing not found' });
      }

      // Verify financing belongs to user's vehicle
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, financingRecord.vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Financing not found' });
      }

      if (!financingRecord.isActive) {
        throw new HTTPException(400, { message: 'Cannot add payment to inactive financing' });
      }

      // Get payment count to determine payment number
      const paymentCount = await paymentRepository.getPaymentCount(financingId);
      const paymentNumber = paymentCount + 1;

      let principalAmount = paymentData.paymentAmount;
      let interestAmount = 0;

      // Calculate payment breakdown for loans
      if (financingRecord.financingType === 'loan' && financingRecord.apr) {
        const breakdown = calculatePaymentBreakdown(
          financingRecord.originalAmount,
          financingRecord.apr,
          financingRecord.termMonths,
          paymentNumber
        );
        principalAmount = Math.min(breakdown.principalAmount, paymentData.paymentAmount);
        interestAmount = Math.min(breakdown.interestAmount, paymentData.paymentAmount);
      }

      // Create payment record
      const newPayment: NewVehicleFinancingPayment = {
        financingId,
        paymentDate: paymentData.paymentDate,
        paymentAmount: paymentData.paymentAmount,
        principalAmount,
        interestAmount,
        remainingBalance: Math.max(0, financingRecord.currentBalance - principalAmount),
        paymentNumber,
        paymentType: paymentData.paymentType,
        isScheduled: false,
      };

      const createdPayment = await paymentRepository.create(newPayment);

      // Update financing balance
      const updatedFinancing = await financingRepository.updateBalance(
        financingId,
        newPayment.remainingBalance
      );

      // Check if financing is paid off/completed
      if (newPayment.remainingBalance <= 0.01) {
        await financingRepository.markAsCompleted(financingId, paymentData.paymentDate);
      }

      return c.json(
        {
          success: true,
          data: {
            payment: createdPayment,
            financing: updatedFinancing,
          },
          message: 'Payment recorded successfully',
        },
        201
      );
    } catch (error) {
      console.error('Error recording financing payment:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to record financing payment' });
    }
  }
);

// GET /api/financing/:financingId/payments - Get payment history
financing.get('/:financingId/payments', zValidator('param', financingParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { financingId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const financingRepository = repositoryFactory.getVehicleFinancingRepository();
    const paymentRepository = repositoryFactory.getVehicleFinancingPaymentRepository();

    const financingRecord = await financingRepository.findById(financingId);
    if (!financingRecord) {
      throw new HTTPException(404, { message: 'Financing not found' });
    }

    // Verify financing belongs to user's vehicle
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, financingRecord.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Financing not found' });
    }

    const payments = await paymentRepository.findByFinancingId(financingId);

    return c.json({
      success: true,
      data: {
        financing: financingRecord,
        payments,
        paymentCount: payments.length,
      },
    });
  } catch (error) {
    console.error('Error fetching financing payments:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch financing payments' });
  }
});

// DELETE /api/financing/:financingId - Delete financing (mark as completed)
financing.delete('/:financingId', zValidator('param', financingParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { financingId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const financingRepository = repositoryFactory.getVehicleFinancingRepository();

    const financingRecord = await financingRepository.findById(financingId);
    if (!financingRecord) {
      throw new HTTPException(404, { message: 'Financing not found' });
    }

    // Verify financing belongs to user's vehicle
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, financingRecord.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Financing not found' });
    }

    await financingRepository.markAsCompleted(financingId, new Date());

    return c.json({
      success: true,
      message: 'Financing marked as completed successfully',
    });
  } catch (error) {
    console.error('Error deleting financing:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to delete financing' });
  }
});

export { financing };
