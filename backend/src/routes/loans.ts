import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { NewLoanPayment, NewVehicleLoan } from '../db/schema';
import {
  calculatePaymentBreakdown,
  generateAmortizationSchedule,
  type LoanTerms,
  validateLoanTerms,
} from '../lib/loan-calculator';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';

const loans = new Hono();

// Validation schemas
const createLoanSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
  lender: z.string().min(1, 'Lender is required').max(100, 'Lender must be 100 characters or less'),
  originalAmount: z.number().min(0.01, 'Original amount must be greater than 0'),
  apr: z.number().min(0, 'APR cannot be negative').max(50, 'APR cannot exceed 50%'),
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
});

const _updateLoanSchema = createLoanSchema.partial().omit({ vehicleId: true });

const loanPaymentSchema = z.object({
  paymentAmount: z.number().min(0.01, 'Payment amount must be greater than 0'),
  paymentDate: z
    .string()
    .datetime()
    .transform((val) => new Date(val)),
  paymentType: z.enum(['standard', 'extra', 'custom-split']).default('standard'),
});

const loanParamsSchema = z.object({
  loanId: z.string().min(1, 'Loan ID is required'),
});

const vehicleParamsSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
});

// Apply authentication to all routes
loans.use('*', requireAuth);

// GET /api/vehicles/:vehicleId/loan - Get loan details for a vehicle
loans.get('/vehicles/:vehicleId/loan', zValidator('param', vehicleParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const loanRepository = repositoryFactory.getVehicleLoanRepository();

    // Verify vehicle belongs to user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }

    const loan = await loanRepository.findByVehicleId(vehicleId);

    if (!loan) {
      return c.json({
        success: true,
        data: null,
        message: 'No loan found for this vehicle',
      });
    }

    return c.json({
      success: true,
      data: loan,
    });
  } catch (error) {
    console.error('Error fetching vehicle loan:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch vehicle loan' });
  }
});

// POST /api/vehicles/:vehicleId/loan - Create or update loan for a vehicle
loans.post(
  '/vehicles/:vehicleId/loan',
  zValidator('param', vehicleParamsSchema),
  zValidator('json', createLoanSchema.omit({ vehicleId: true })),
  async (c) => {
    try {
      const user = c.get('user');
      const { vehicleId } = c.req.valid('param');
      const loanData = c.req.valid('json');

      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const loanRepository = repositoryFactory.getVehicleLoanRepository();

      // Verify vehicle belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }

      // Validate loan terms
      const loanTerms: LoanTerms = {
        principal: loanData.originalAmount,
        apr: loanData.apr,
        termMonths: loanData.termMonths,
        startDate: loanData.startDate,
      };

      const validationErrors = validateLoanTerms(loanTerms);
      if (validationErrors.length > 0) {
        throw new HTTPException(400, {
          message: 'Invalid loan terms',
          cause: validationErrors,
        });
      }

      // Check if loan already exists for this vehicle
      const existingLoan = await loanRepository.findByVehicleId(vehicleId);

      if (existingLoan) {
        // Update existing loan
        const updatedLoan = await loanRepository.update(existingLoan.id, {
          ...loanData,
          currentBalance: loanData.originalAmount, // Reset balance when updating terms
        });

        return c.json({
          success: true,
          data: updatedLoan,
          message: 'Loan updated successfully',
        });
      } else {
        // Create new loan
        const newLoan: NewVehicleLoan = {
          ...loanData,
          vehicleId,
          currentBalance: loanData.originalAmount,
        };

        const createdLoan = await loanRepository.create(newLoan);

        return c.json(
          {
            success: true,
            data: createdLoan,
            message: 'Loan created successfully',
          },
          201
        );
      }
    } catch (error) {
      console.error('Error creating/updating vehicle loan:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to create/update vehicle loan' });
    }
  }
);

// GET /api/loans/:loanId/schedule - Get amortization schedule
loans.get('/:loanId/schedule', zValidator('param', loanParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { loanId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const loanRepository = repositoryFactory.getVehicleLoanRepository();

    const loan = await loanRepository.findById(loanId);
    if (!loan) {
      throw new HTTPException(404, { message: 'Loan not found' });
    }

    // Verify loan belongs to user's vehicle
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, loan.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Loan not found' });
    }

    const loanTerms: LoanTerms = {
      principal: loan.originalAmount,
      apr: loan.apr,
      termMonths: loan.termMonths,
      startDate: loan.startDate,
    };

    const analysis = generateAmortizationSchedule(loanTerms);

    return c.json({
      success: true,
      data: {
        loan,
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

// POST /api/loans/:loanId/payment - Record a loan payment
loans.post(
  '/:loanId/payment',
  zValidator('param', loanParamsSchema),
  zValidator('json', loanPaymentSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { loanId } = c.req.valid('param');
      const paymentData = c.req.valid('json');

      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const loanRepository = repositoryFactory.getVehicleLoanRepository();
      const paymentRepository = repositoryFactory.getLoanPaymentRepository();

      const loan = await loanRepository.findById(loanId);
      if (!loan) {
        throw new HTTPException(404, { message: 'Loan not found' });
      }

      // Verify loan belongs to user's vehicle
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, loan.vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Loan not found' });
      }

      if (!loan.isActive) {
        throw new HTTPException(400, { message: 'Cannot add payment to inactive loan' });
      }

      // Get payment count to determine payment number
      const paymentCount = await paymentRepository.getPaymentCount(loanId);
      const paymentNumber = paymentCount + 1;

      // Calculate payment breakdown
      const breakdown = calculatePaymentBreakdown(
        loan.originalAmount,
        loan.apr,
        loan.termMonths,
        paymentNumber
      );

      // Create payment record
      const newPayment: NewLoanPayment = {
        loanId,
        paymentDate: paymentData.paymentDate,
        paymentAmount: paymentData.paymentAmount,
        principalAmount: Math.min(breakdown.principalAmount, paymentData.paymentAmount),
        interestAmount: Math.min(breakdown.interestAmount, paymentData.paymentAmount),
        remainingBalance: Math.max(
          0,
          loan.currentBalance - Math.min(breakdown.principalAmount, paymentData.paymentAmount)
        ),
        paymentNumber,
        paymentType: paymentData.paymentType,
        isScheduled: false,
      };

      const createdPayment = await paymentRepository.create(newPayment);

      // Update loan balance
      const updatedLoan = await loanRepository.updateBalance(loanId, newPayment.remainingBalance);

      // Check if loan is paid off
      if (newPayment.remainingBalance <= 0.01) {
        await loanRepository.markAsPaidOff(loanId, paymentData.paymentDate);
      }

      return c.json(
        {
          success: true,
          data: {
            payment: createdPayment,
            loan: updatedLoan,
          },
          message: 'Payment recorded successfully',
        },
        201
      );
    } catch (error) {
      console.error('Error recording loan payment:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to record loan payment' });
    }
  }
);

// GET /api/loans/:loanId/payments - Get payment history
loans.get('/:loanId/payments', zValidator('param', loanParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { loanId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const loanRepository = repositoryFactory.getVehicleLoanRepository();
    const paymentRepository = repositoryFactory.getLoanPaymentRepository();

    const loan = await loanRepository.findById(loanId);
    if (!loan) {
      throw new HTTPException(404, { message: 'Loan not found' });
    }

    // Verify loan belongs to user's vehicle
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, loan.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Loan not found' });
    }

    const payments = await paymentRepository.findByLoanId(loanId);

    return c.json({
      success: true,
      data: {
        loan,
        payments,
        paymentCount: payments.length,
      },
    });
  } catch (error) {
    console.error('Error fetching loan payments:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch loan payments' });
  }
});

// DELETE /api/loans/:loanId - Delete loan (mark as paid off)
loans.delete('/:loanId', zValidator('param', loanParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { loanId } = c.req.valid('param');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const loanRepository = repositoryFactory.getVehicleLoanRepository();

    const loan = await loanRepository.findById(loanId);
    if (!loan) {
      throw new HTTPException(404, { message: 'Loan not found' });
    }

    // Verify loan belongs to user's vehicle
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, loan.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Loan not found' });
    }

    await loanRepository.markAsPaidOff(loanId, new Date());

    return c.json({
      success: true,
      message: 'Loan marked as paid off successfully',
    });
  } catch (error) {
    console.error('Error deleting loan:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to delete loan' });
  }
});

export { loans };
