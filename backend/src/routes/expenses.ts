import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { NewExpense } from '../db/schema';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';

// Types for expense data
type ExpenseData = {
  id: string;
  amount: number;
  category: string;
  type: string;
  date: Date;
  description?: string | null;
  mileage?: number | null;
  gallons?: number | null;
  vehicleId: string;
};

const expenses = new Hono();

// Helper functions
function validateFuelExpenseUpdate(
  updateData: Partial<NewExpense>,
  existingExpense: ExpenseData
): void {
  if (updateData.type === 'fuel' || existingExpense.type === 'fuel') {
    const finalType = updateData.type || existingExpense.type;
    const finalGallons =
      updateData.gallons !== undefined ? updateData.gallons : existingExpense.gallons;
    const finalMileage =
      updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;

    if (finalType === 'fuel' && (!finalGallons || !finalMileage)) {
      throw new HTTPException(400, {
        message: 'Fuel expenses require both gallons and mileage data',
      });
    }
  }
}

// Validation schemas
const expenseTypeSchema = z.enum([
  // Operating Costs
  'fuel',
  'tolls',
  'parking',
  // Maintenance & Repairs
  'maintenance',
  'repairs',
  'tires',
  'oil-change',
  // Financial
  'insurance',
  'loan-payment',
  // Regulatory/Legal
  'registration',
  'inspection',
  'emissions',
  'tickets',
  // Enhancements/Modifications
  'modifications',
  'accessories',
  'detailing',
  // Other
  'other',
]);

const expenseCategorySchema = z.enum([
  'operating', // Day-to-day driving costs (fuel, tolls, parking)
  'maintenance', // Keeping the car running (oil, repairs, tires)
  'financial', // Loans, insurance
  'regulatory', // Government-required (registration, inspection, tickets)
  'enhancement', // Optional improvements (tint, accessories, detailing)
  'convenience', // Nice-to-have (vanity plates, car washes)
]);

const createExpenseSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
  type: expenseTypeSchema,
  category: expenseCategorySchema,
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency must be 3 characters').default('USD'),
  date: z
    .string()
    .datetime()
    .transform((val) => new Date(val)),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').nullable().optional(),
  gallons: z.number().positive('Gallons must be positive').optional(),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  receiptUrl: z.string().url('Receipt URL must be valid').optional(),
});

const updateExpenseSchema = createExpenseSchema.partial();

const expenseParamsSchema = z.object({
  id: z.string().min(1, 'Expense ID is required'),
});

const expenseQuerySchema = z.object({
  vehicleId: z.string().optional(),
  type: expenseTypeSchema.optional(),
  category: expenseCategorySchema.optional(),
  startDate: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .optional(),
  offset: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(0))
    .optional(),
});

// Apply authentication to all routes
expenses.use('*', requireAuth);

// GET /api/expenses/categories - Get expense categories and types
expenses.get('/categories', async (c) => {
  return c.json({
    success: true,
    data: {
      types: [
        // Operating Costs
        'fuel',
        'tolls',
        'parking',
        // Maintenance & Repairs
        'maintenance',
        'repairs',
        'tires',
        'oil-change',
        // Financial
        'insurance',
        'loan-payment',
        // Regulatory/Legal
        'registration',
        'inspection',
        'emissions',
        'tickets',
        // Enhancements/Modifications
        'modifications',
        'accessories',
        'detailing',
        // Other
        'other',
      ],
      categories: [
        'operating', // Day-to-day driving costs (fuel, tolls, parking)
        'maintenance', // Keeping the car running (oil, repairs, tires)
        'financial', // Loans, insurance
        'regulatory', // Government-required (registration, inspection, tickets)
        'enhancement', // Optional improvements (tint, accessories, detailing)
        'convenience', // Nice-to-have (vanity plates, car washes)
      ],
      categoryMapping: {
        operating: ['fuel', 'tolls', 'parking'],
        maintenance: ['maintenance', 'repairs', 'tires', 'oil-change'],
        financial: ['insurance', 'loan-payment'],
        regulatory: ['registration', 'inspection', 'emissions', 'tickets'],
        enhancement: ['modifications', 'accessories', 'detailing'],
        convenience: ['other'],
      },
    },
  });
});

// POST /api/expenses - Create a new expense
expenses.post('/', zValidator('json', createExpenseSchema), async (c) => {
  try {
    const user = c.get('user');
    const expenseData = c.req.valid('json');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const expenseRepository = repositoryFactory.getExpenseRepository();

    // Verify vehicle exists and belongs to user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, expenseData.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Vehicle not found' });
    }

    // Validate fuel expense requirements
    if (expenseData.type === 'fuel') {
      if (!expenseData.gallons || !expenseData.mileage) {
        throw new HTTPException(400, {
          message: 'Fuel expenses require both gallons and mileage data',
        });
      }
    }

    const newExpense: NewExpense = {
      ...expenseData,
    };

    const createdExpense = await expenseRepository.create(newExpense);

    return c.json(
      {
        success: true,
        data: createdExpense,
        message: 'Expense created successfully',
      },
      201
    );
  } catch (error) {
    console.error('Error creating expense:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to create expense' });
  }
});

// Helper function to fetch expenses for a vehicle based on query filters
async function fetchVehicleExpenses(
  expenseRepository: ReturnType<typeof repositoryFactory.getExpenseRepository>,
  vehicleId: string,
  query: {
    startDate?: Date;
    endDate?: Date;
    type?: string;
    category?: string;
  }
): Promise<ExpenseData[]> {
  if (query.startDate && query.endDate) {
    return await expenseRepository.findByVehicleIdAndDateRange(
      vehicleId,
      query.startDate,
      query.endDate
    );
  }
  if (query.type) {
    return await expenseRepository.findByType(vehicleId, query.type);
  }
  if (query.category) {
    return await expenseRepository.findByCategory(vehicleId, query.category);
  }
  return await expenseRepository.findByVehicleId(vehicleId);
}

// GET /api/expenses - Get all expenses for the user (with optional vehicle filter)
expenses.get('/', zValidator('query', expenseQuerySchema), async (c) => {
  try {
    const user = c.get('user');
    const query = c.req.valid('query');

    const vehicleRepository = repositoryFactory.getVehicleRepository();
    const expenseRepository = repositoryFactory.getExpenseRepository();

    // Get all user vehicles
    const userVehicles = await vehicleRepository.findByUserId(user.id);
    const vehicleIds = userVehicles.map((v) => v.id);

    if (vehicleIds.length === 0) {
      return c.json({
        success: true,
        data: [],
        count: 0,
      });
    }

    let allExpenses: ExpenseData[] = [];

    // If vehicleId filter is provided, only get expenses for that vehicle
    if (query.vehicleId) {
      // Verify user owns this vehicle
      if (!vehicleIds.includes(query.vehicleId)) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }

      allExpenses = await fetchVehicleExpenses(expenseRepository, query.vehicleId, query);
    } else {
      // Get expenses for all user vehicles
      const expensePromises = vehicleIds.map((vehicleId) =>
        fetchVehicleExpenses(expenseRepository, vehicleId, query)
      );
      const expenseArrays = await Promise.all(expensePromises);
      allExpenses = expenseArrays.flat();
    }

    // Sort by date (newest first)
    allExpenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Apply pagination if specified
    if (query.limit || query.offset) {
      const offset = query.offset || 0;
      const limit = query.limit || 50;
      allExpenses = allExpenses.slice(offset, offset + limit);
    }

    return c.json({
      success: true,
      data: allExpenses,
      count: allExpenses.length,
      filters: {
        vehicleId: query.vehicleId,
        type: query.type,
        category: query.category,
        startDate: query.startDate,
        endDate: query.endDate,
      },
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch expenses' });
  }
});

// GET /api/expenses/:id - Get specific expense
expenses.get('/:id', zValidator('param', expenseParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const expenseRepository = repositoryFactory.getExpenseRepository();
    const vehicleRepository = repositoryFactory.getVehicleRepository();

    const expense = await expenseRepository.findById(id);
    if (!expense) {
      throw new HTTPException(404, { message: 'Expense not found' });
    }

    // Verify the expense belongs to a vehicle owned by the user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, expense.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Expense not found' });
    }

    return c.json({
      success: true,
      data: expense,
    });
  } catch (error) {
    console.error('Error fetching expense:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to fetch expense' });
  }
});

// PUT /api/expenses/:id - Update expense
expenses.put(
  '/:id',
  zValidator('param', expenseParamsSchema),
  zValidator('json', updateExpenseSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const updateData = c.req.valid('json');

      const expenseRepository = repositoryFactory.getExpenseRepository();
      const vehicleRepository = repositoryFactory.getVehicleRepository();

      // Check if expense exists
      const existingExpense = await expenseRepository.findById(id);
      if (!existingExpense) {
        throw new HTTPException(404, { message: 'Expense not found' });
      }

      // Verify the expense belongs to a vehicle owned by the user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, existingExpense.vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Expense not found' });
      }

      // Validate fuel expense requirements
      validateFuelExpenseUpdate(updateData, existingExpense);

      const updatedExpense = await expenseRepository.update(id, updateData);

      return c.json({
        success: true,
        data: updatedExpense,
        message: 'Expense updated successfully',
      });
    } catch (error) {
      console.error('Error updating expense:', error);

      if (error instanceof HTTPException) {
        throw error;
      }

      throw new HTTPException(500, { message: 'Failed to update expense' });
    }
  }
);

// DELETE /api/expenses/:id - Delete expense
expenses.delete('/:id', zValidator('param', expenseParamsSchema), async (c) => {
  try {
    const user = c.get('user');
    const { id } = c.req.valid('param');

    const expenseRepository = repositoryFactory.getExpenseRepository();
    const vehicleRepository = repositoryFactory.getVehicleRepository();

    // Check if expense exists
    const existingExpense = await expenseRepository.findById(id);
    if (!existingExpense) {
      throw new HTTPException(404, { message: 'Expense not found' });
    }

    // Verify the expense belongs to a vehicle owned by the user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, existingExpense.vehicleId);
    if (!vehicle) {
      throw new HTTPException(404, { message: 'Expense not found' });
    }

    await expenseRepository.delete(id);

    return c.json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting expense:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to delete expense' });
  }
});

export { expenses };
