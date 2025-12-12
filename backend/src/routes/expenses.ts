import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { type Expense, expenses as expensesTable } from '../db/schema';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
} from '../db/types';
import { VALIDATION_LIMITS } from '../lib/constants';
import { NotFoundError, ValidationError } from '../lib/core/errors/';
import { requireAuth } from '../lib/middleware/auth';
import { trackDataChanges } from '../lib/middleware/change-tracker';
import { expenseRepository, vehicleRepository } from '../lib/repositories';

const expenses = new Hono();

// Validation schemas derived from db schema
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const baseExpenseSchema = createInsertSchema(expensesTable, {
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(
          VALIDATION_LIMITS.EXPENSE.TAG_MAX_LENGTH,
          `Tag must be ${VALIDATION_LIMITS.EXPENSE.TAG_MAX_LENGTH} characters or less`
        )
    )
    .max(
      VALIDATION_LIMITS.EXPENSE.MAX_TAGS,
      `Maximum ${VALIDATION_LIMITS.EXPENSE.MAX_TAGS} tags allowed`
    )
    .optional()
    .default([]),
  category: expenseCategorySchema,
  expenseAmount: z.number().positive('Expense amount must be positive'),
  fuelAmount: z.number().positive('Fuel amount must be positive').nullable().optional(),
  date: z.coerce.date(),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').nullable().optional(),
  description: z
    .string()
    .max(
      VALIDATION_LIMITS.EXPENSE.DESCRIPTION_MAX_LENGTH,
      `Description must be ${VALIDATION_LIMITS.EXPENSE.DESCRIPTION_MAX_LENGTH} characters or less`
    )
    .optional(),
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

const createExpenseSchema = baseExpenseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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

// Apply authentication and change tracking to all routes
expenses.use('*', requireAuth);
expenses.use('*', trackDataChanges);

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
  const user = c.get('user');
  const expenseData = c.req.valid('json');

  // Verify vehicle exists and belongs to user
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, expenseData.vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  // Validate fuel expense requirements
  validateFuelExpenseData(expenseData.category, expenseData.mileage, expenseData.fuelAmount);

  const createdExpense = await expenseRepository.create(expenseData);

  return c.json(
    {
      success: true,
      data: createdExpense,
      message: 'Expense created successfully',
    },
    201
  );
});

// Note: With Drizzle JSON mode, tags are automatically parsed/stringified
// No need for manual JSON.parse/stringify helper functions

/**
 * Validate fuel expense requirements
 * Extracted to reduce complexity in update handler
 */
function validateFuelExpenseData(
  category: string,
  mileage: number | null | undefined,
  fuelAmount: number | null | undefined
): void {
  if (category === 'fuel') {
    if (!fuelAmount || !mileage) {
      throw new ValidationError('Fuel expenses require fuelAmount and mileage data');
    }
  }
}

// Helper function to fetch expenses for a vehicle based on query filters
async function fetchVehicleExpenses(
  vehicleId: string,
  query: {
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    category?: string;
  }
): Promise<Expense[]> {
  const expenses = await expenseRepository.find({
    vehicleId,
    category: query.category,
    startDate: query.startDate,
    endDate: query.endDate,
  });

  // Filter by tags if specified
  if (query.tags && query.tags.length > 0) {
    return expenses.filter((expense) => query.tags?.some((tag) => expense.tags?.includes(tag)));
  }

  return expenses;
}

// GET /api/expenses - Get all expenses for the user (with optional vehicle filter)
expenses.get('/', zValidator('query', expenseQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');

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

  let allExpenses: Expense[] = [];

  // If vehicleId filter is provided, only get expenses for that vehicle
  if (query.vehicleId) {
    // Verify user owns this vehicle
    if (!vehicleIds.includes(query.vehicleId)) {
      throw new NotFoundError('Vehicle');
    }

    allExpenses = await fetchVehicleExpenses(query.vehicleId, query);
  } else {
    // Get expenses for all user vehicles
    const expensePromises = vehicleIds.map((vehicleId) => fetchVehicleExpenses(vehicleId, query));
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
});

// GET /api/expenses/:id - Get specific expense
expenses.get('/:id', zValidator('param', expenseParamsSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const expense = await expenseRepository.findById(id);
  if (!expense) {
    throw new NotFoundError('Expense');
  }

  // Verify the expense belongs to a vehicle owned by the user
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, expense.vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Expense');
  }

  return c.json({
    success: true,
    data: expense,
  });
});

// PUT /api/expenses/:id - Update expense
expenses.put(
  '/:id',
  zValidator('param', expenseParamsSchema),
  zValidator('json', updateExpenseSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');

    // Check if expense exists
    const existingExpense = await expenseRepository.findById(id);
    if (!existingExpense) {
      throw new NotFoundError('Expense');
    }

    // Verify the expense belongs to a vehicle owned by the user
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, existingExpense.vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Expense');
    }

    // Validate fuel expense requirements with merged data
    const finalCategory =
      updateData.category !== undefined ? updateData.category : existingExpense.category;
    const finalMileage =
      updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;
    const finalFuelAmount =
      updateData.fuelAmount !== undefined ? updateData.fuelAmount : existingExpense.fuelAmount;

    validateFuelExpenseData(finalCategory, finalMileage, finalFuelAmount);

    const updatedExpense = await expenseRepository.update(id, updateData);

    return c.json({
      success: true,
      data: updatedExpense,
      message: 'Expense updated successfully',
    });
  }
);

// DELETE /api/expenses/:id - Delete expense
expenses.delete('/:id', zValidator('param', expenseParamsSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // Check if expense exists
  const existingExpense = await expenseRepository.findById(id);
  if (!existingExpense) {
    throw new NotFoundError('Expense');
  }

  // Verify the expense belongs to a vehicle owned by the user
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, existingExpense.vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Expense');
  }

  await expenseRepository.delete(id);

  return c.json({
    success: true,
    message: 'Expense deleted successfully',
  });
});

export { expenses };
