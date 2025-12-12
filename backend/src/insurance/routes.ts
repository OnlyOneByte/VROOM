import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CONFIG } from '../config';
import { insurancePolicies } from '../db/schema';
import { changeTracker, requireAuth } from '../middleware';
import { logger } from '../utils/logger';
import { commonSchemas } from '../utils/validation';
import { vehicleRepository } from '../vehicles/repository';
import { insurancePolicyRepository } from './repository';

const routes = new Hono();

// Validation schemas derived from db schema
const baseInsuranceSchema = createInsertSchema(insurancePolicies, {
  company: z
    .string()
    .min(1, 'Insurance company is required')
    .max(
      CONFIG.validation.insurance.companyMaxLength,
      `Company name must be ${CONFIG.validation.insurance.companyMaxLength} characters or less`
    ),
  policyNumber: z
    .string()
    .max(
      CONFIG.validation.insurance.policyNumberMaxLength,
      `Policy number must be ${CONFIG.validation.insurance.policyNumberMaxLength} characters or less`
    )
    .optional(),
  totalCost: z.number().positive('Total cost must be positive'),
  termLengthMonths: z
    .number()
    .int()
    .min(1, 'Term length must be at least 1 month')
    .max(
      CONFIG.validation.insurance.maxTermMonths,
      `Term length cannot exceed ${CONFIG.validation.insurance.maxTermMonths} months`
    ),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

const createInsurancePolicySchema = baseInsuranceSchema.omit({
  id: true,
  monthlyCost: true,
  createdAt: true,
  updatedAt: true,
});

const updateInsurancePolicySchema = createInsurancePolicySchema.partial();

const insurancePolicyParamsSchema = z.object({
  id: z.string().min(1, 'Insurance policy ID is required'),
});

// Apply authentication and change tracking to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// GET /api/insurance/expiring-soon - Get policies expiring soon (must be before /:id route)
routes.get('/expiring-soon', async (c) => {
  try {
    const user = c.get('user');
    const daysAhead = parseInt(c.req.query('days') || '30', 10);

    const expiringPolicies = await insurancePolicyRepository.findExpiringPolicies(
      user.id,
      daysAhead
    );

    return c.json({
      success: true,
      data: expiringPolicies,
      count: expiringPolicies.length,
      daysAhead,
    });
  } catch (error) {
    logger.error('Error fetching expiring policies', { error });

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch expiring policies' });
  }
});

// POST /api/insurance/vehicles/:id/policies - Create insurance policy for vehicle
routes.post(
  '/vehicles/:id/policies',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', createInsurancePolicySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id: vehicleId } = c.req.valid('param');
      const policyData = c.req.valid('json');

      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }

      // Validate date range
      if (policyData.endDate <= policyData.startDate) {
        throw new HTTPException(400, { message: 'End date must be after start date' });
      }

      // Calculate monthly cost
      const monthlyCost = policyData.totalCost / policyData.termLengthMonths;

      const newPolicy = {
        ...policyData,
        vehicleId,
        monthlyCost,
        isActive: true,
      };

      const createdPolicy = await insurancePolicyRepository.create(newPolicy);

      return c.json(
        {
          success: true,
          data: createdPolicy,
          message: 'Insurance policy created successfully',
        },
        201
      );
    } catch (error) {
      logger.error('Error creating insurance policy', { error });

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to create insurance policy' });
    }
  }
);

// GET /api/insurance/vehicles/:id/policies - Get vehicle insurance policies
routes.get('/vehicles/:id/policies', zValidator('param', commonSchemas.idParam), async (c) => {
  try {
    const user = c.get('user');
    const { id: vehicleId } = c.req.valid('param');

    // Verify vehicle exists and belongs to user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }

    const policies = await insurancePolicyRepository.findByVehicleId(vehicleId);

    // Add expiration alerts
    const policiesWithAlerts = policies.map((policy) => {
      const daysUntilExpiration = Math.ceil(
        (new Date(policy.endDate).getTime() - Date.now()) / CONFIG.time.msPerDay
      );

      return {
        ...policy,
        daysUntilExpiration,
        expirationAlert:
          daysUntilExpiration <= 30
            ? {
                type: 'expiration_warning',
                severity: daysUntilExpiration <= 7 ? 'high' : 'medium',
                message: `Policy expires in ${daysUntilExpiration} days`,
                daysRemaining: daysUntilExpiration,
              }
            : null,
      };
    });

    return c.json({
      success: true,
      data: policiesWithAlerts,
      count: policies.length,
    });
  } catch (error) {
    logger.error('Error fetching insurance policies', { error });

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch insurance policies' });
  }
});

// GET /api/insurance/:id - Get specific insurance policy
routes.get('/:id', zValidator('param', insurancePolicyParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const policy = await insurancePolicyRepository.findById(id);
    if (!policy) {
      throw new HTTPException(404, { message: 'Insurance policy not found' });
    }

    // Verify the policy belongs to a vehicle owned by the user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, policy.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Insurance policy not found' });
    }

    return c.json({
      success: true,
      data: policy,
    });
  } catch (error) {
    logger.error('Error fetching insurance policy', { error });

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch insurance policy' });
  }
});

// PUT /api/insurance/:id - Update insurance policy
routes.put(
  '/:id',
  zValidator('param', insurancePolicyParamsSchema),
  zValidator('json', updateInsurancePolicySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const updateData = c.req.valid('json');

      // Check if policy exists
      const existingPolicy = await insurancePolicyRepository.findById(id);
      if (!existingPolicy) {
        throw new HTTPException(404, { message: 'Insurance policy not found' });
      }

      // Verify the policy belongs to a vehicle owned by the user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, existingPolicy.vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Insurance policy not found' });
      }

      // Validate date range if dates are being updated
      if (updateData.startDate || updateData.endDate) {
        const startDate = updateData.startDate || existingPolicy.startDate;
        const endDate = updateData.endDate || existingPolicy.endDate;

        if (endDate <= startDate) {
          throw new HTTPException(400, { message: 'End date must be after start date' });
        }
      }

      // Recalculate monthly cost if total cost or term length changes
      const finalUpdateData: Record<string, unknown> = { ...updateData };
      if (updateData.totalCost || updateData.termLengthMonths) {
        const totalCost = updateData.totalCost || existingPolicy.totalCost;
        const termLengthMonths = updateData.termLengthMonths || existingPolicy.termLengthMonths;
        finalUpdateData.monthlyCost = totalCost / termLengthMonths;
      }

      const updatedPolicy = await insurancePolicyRepository.update(id, finalUpdateData);

      return c.json({
        success: true,
        data: updatedPolicy,
        message: 'Insurance policy updated successfully',
      });
    } catch (error) {
      logger.error('Error updating insurance policy', { error });

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to update insurance policy' });
    }
  }
);

// DELETE /api/insurance/:id - Delete insurance policy
routes.delete('/:id', zValidator('param', insurancePolicyParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    // Check if policy exists
    const existingPolicy = await insurancePolicyRepository.findById(id);
    if (!existingPolicy) {
      throw new HTTPException(404, { message: 'Insurance policy not found' });
    }

    // Verify the policy belongs to a vehicle owned by the user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, existingPolicy.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Insurance policy not found' });
    }

    await insurancePolicyRepository.delete(id);

    return c.json({
      success: true,
      message: 'Insurance policy deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting insurance policy', { error });

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to delete insurance policy' });
  }
});

// GET /api/insurance/:id/monthly-breakdown - Get monthly cost breakdown
routes.get(
  '/:id/monthly-breakdown',
  zValidator('param', insurancePolicyParamsSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id } = c.req.valid('param');

      const policy = await insurancePolicyRepository.findById(id);
      if (!policy) {
        throw new HTTPException(404, { message: 'Insurance policy not found' });
      }

      // Verify the policy belongs to a vehicle owned by the user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, policy.vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Insurance policy not found' });
      }

      // Calculate monthly breakdown
      const monthlyBreakdown = calculateMonthlyBreakdown(policy);

      return c.json({
        success: true,
        data: {
          policyId: policy.id,
          company: policy.company,
          totalCost: policy.totalCost,
          termLengthMonths: policy.termLengthMonths,
          monthlyCost: policy.monthlyCost,
          breakdown: monthlyBreakdown,
        },
      });
    } catch (error) {
      logger.error('Error calculating monthly breakdown', { error });

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to calculate monthly breakdown' });
    }
  }
);

// Helper function to calculate monthly breakdown
function calculateMonthlyBreakdown(policy: {
  startDate: Date;
  endDate: Date;
  monthlyCost: number;
  termLengthMonths: number;
}) {
  const startDate = new Date(policy.startDate);
  const endDate = new Date(policy.endDate);
  const monthlyCost = policy.monthlyCost;

  const breakdown: {
    month: number;
    cost: number;
    monthName: string;
    startDate?: string;
    endDate?: string;
    isPaid?: boolean;
    daysInMonth?: number;
  }[] = [];
  const currentDate = new Date(startDate);
  let monthNumber = 1;

  while (currentDate < endDate && monthNumber <= policy.termLengthMonths) {
    const monthStart = new Date(currentDate);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Adjust for policy end date
    if (monthEnd > endDate) {
      monthEnd.setTime(endDate.getTime());
    }

    breakdown.push({
      month: monthNumber,
      monthName: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      startDate: monthStart.toISOString().split('T')[0],
      endDate: monthEnd.toISOString().split('T')[0],
      cost: Math.round(monthlyCost * 100) / 100,
      isPaid: monthEnd < new Date(), // Assume past months are paid
      daysInMonth:
        Math.ceil((monthEnd.getTime() - monthStart.getTime()) / CONFIG.time.msPerDay) + 1,
    });

    currentDate.setMonth(currentDate.getMonth() + 1);
    monthNumber++;
  }

  return breakdown;
}

export { routes };
