import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { NewExpense } from '../db/schema';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
} from '../db/types';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';

// Types for expense data (from database)
type ExpenseDataRaw = {
  id: string;
  amount: number;
  category: string;
  tags: string | null; // JSON string from database
  date: Date;
  description?: string | null;
  mileage?: number | null;
  volume?: number | null;
  charge?: number | null;
  vehicleId: string;
};

// Types for expense data (parsed for API)
type ExpenseData = {
  id: string;
  amount: number;
  category: string;
  tags: string[]; // Parsed array
  date: Date;
  description?: string | null;
  mileage?: number | null;
  volume?: number | null;
  charge?: number | null;
  vehicleId: string;
};

const expenses = new Hono();

// Validation schemas
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const createExpenseSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
  tags: z
    .array(z.string().min(1).max(50))
    .max(10, 'Maximum 10 tags allowed')
    .optional()
    .default([]),
  category: expenseCategorySchema,
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency must be 3 characters').default('USD'),
  date: z.coerce.date(),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').nullable().optional(),
  volume: z.number().positive('Volume must be positive').optional(),
  charge: z.number().positive('Charge must be positive').optional(),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  receiptUrl: z
    .string()
    .refine((val) => {
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    }, 'Receipt URL must be valid')
    .optional(),
});

const updateExpenseSchema = createExpenseSchema.partial();

const expenseParamsSchema = z.object({
  id: z.string().min(1, 'Expense ID is required'),
});

const expenseQuerySchema = z.object({
  vehicleId: z.string().optional(),
  tags: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((t) => t.trim()) : undefined)),
  category: expenseCategorySchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
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

// GET /api/expenses/categories - Get expense categories
expenses.get('/categories', async (c) => {
  return c.json({
    success: true,
    data: EXPENSE_CATEGORIES.map((category) => ({
      value: category,
      label: EXPENSE_CATEGORY_LABELS[category],
      description: EXPENSE_CATEGORY_DESCRIPTIONS[category],
    })),
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
    const category = expenseData.category as string;
    if (category === 'fuel') {
      if ((!expenseData.volume && !expenseData.charge) || !expenseData.mileage) {
        throw new HTTPException(400, {
          message: 'Fuel expenses require volume/charge and mileage data',
        });
      }
    }

    const newExpense: NewExpense = {
      ...expenseData,
      tags: JSON.stringify(expenseData.tags), // Store as JSON string
    };

    const createdExpense = await expenseRepository.create(newExpense);

    // Parse tags from JSON string for response
    const parsedExpense = parseExpenseTags(createdExpense as ExpenseDataRaw);

    return c.json(
      {
        success: true,
        data: parsedExpense,
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

// Helper function to parse expense tags
function parseExpenseTags(expense: ExpenseDataRaw): ExpenseData {
  return {
    ...expense,
    tags: expense.tags ? JSON.parse(expense.tags) : [],
  };
}

// Helper function to fetch expenses for a vehicle based on query filters
async function fetchVehicleExpenses(
  expenseRepository: ReturnType<typeof repositoryFactory.getExpenseRepository>,
  vehicleId: string,
  query: {
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    category?: string;
  }
): Promise<ExpenseData[]> {
  let expenses: ExpenseDataRaw[] = [];

  if (query.startDate && query.endDate) {
    expenses = (await expenseRepository.findByVehicleIdAndDateRange(
      vehicleId,
      query.startDate,
      query.endDate
    )) as ExpenseDataRaw[];
  } else if (query.category) {
    expenses = (await expenseRepository.findByCategory(
      vehicleId,
      query.category
    )) as ExpenseDataRaw[];
  } else {
    expenses = (await expenseRepository.findByVehicleId(vehicleId)) as ExpenseDataRaw[];
  }

  // Parse tags from JSON strings
  const parsedExpenses = expenses.map(parseExpenseTags);

  // Filter by tags if specified
  if (query.tags && query.tags.length > 0) {
    return parsedExpenses.filter((expense) =>
      query.tags?.some((tag) => expense.tags.includes(tag))
    );
  }

  return parsedExpenses;
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
        tags: query.tags,
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

    // Parse tags from JSON string
    const parsedExpense = parseExpenseTags(expense as ExpenseDataRaw);

    return c.json({
      success: true,
      data: parsedExpense,
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
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex validation logic required
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

      // Parse existing expense tags
      const parsedExistingExpense = parseExpenseTags(existingExpense as ExpenseDataRaw);

      // Handle tags - merge with existing if provided
      const tags = updateData.tags !== undefined ? updateData.tags : parsedExistingExpense.tags;

      // Validate fuel expense requirements
      const finalCategory = (
        updateData.category !== undefined ? updateData.category : existingExpense.category
      ) as string;
      if (finalCategory === 'fuel') {
        const finalMileage =
          updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;
        const finalVolume =
          updateData.volume !== undefined ? updateData.volume : existingExpense.volume;
        const finalCharge =
          updateData.charge !== undefined ? updateData.charge : existingExpense.charge;

        if ((!finalVolume && !finalCharge) || !finalMileage) {
          throw new HTTPException(400, {
            message: 'Fuel expenses require volume/charge and mileage data',
          });
        }
      }

      // Convert tags array to JSON string if present
      const updatePayload: Partial<NewExpense> = {
        ...updateData,
        tags: Array.isArray(tags) ? JSON.stringify(tags) : tags,
      };

      const updatedExpense = await expenseRepository.update(id, updatePayload);

      // Parse tags from JSON string for response
      const parsedUpdatedExpense = parseExpenseTags(updatedExpense as ExpenseDataRaw);

      return c.json({
        success: true,
        data: parsedUpdatedExpense,
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
