import { zValidator } from '@hono/zod-validator';
import { createInsertSchema } from 'drizzle-zod';
import { Hono } from 'hono';
import { z } from 'zod';
import { CONFIG } from '../../config';
import { expenses as expensesTable } from '../../db/schema';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_DESCRIPTIONS,
  EXPENSE_CATEGORY_LABELS,
} from '../../db/types';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse } from '../../utils/pagination';
import {
  commonSchemas,
  validateExpenseOwnership,
  validateFuelExpenseData,
} from '../../utils/validation';
import {
  handleFinancingOnCreate,
  handleFinancingOnDelete,
  handleFinancingOnUpdate,
} from '../financing/hooks';
import { financingRepository } from '../financing/repository';
import {
  handleOdometerOnExpenseCreate,
  handleOdometerOnExpenseDelete,
  handleOdometerOnExpenseUpdate,
} from '../odometer/hooks';
import { vehicleRepository } from '../vehicles/repository';
import { expenseRepository } from './repository';
import { createSplitExpenseSchema, updateSplitSchema } from './validation';

const routes = new Hono();

// Validation schemas derived from db schema
const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const baseExpenseSchema = createInsertSchema(expensesTable, {
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(
          CONFIG.validation.expense.tagMaxLength,
          `Tag must be ${CONFIG.validation.expense.tagMaxLength} characters or less`
        )
    )
    .max(
      CONFIG.validation.expense.maxTags,
      `Maximum ${CONFIG.validation.expense.maxTags} tags allowed`
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
      CONFIG.validation.expense.descriptionMaxLength,
      `Description must be ${CONFIG.validation.expense.descriptionMaxLength} characters or less`
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
  isFinancingPayment: z.boolean().optional().default(false),
});

const createExpenseSchema = baseExpenseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const updateExpenseSchema = createExpenseSchema.partial();

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
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// ===========================================================================
// Split expense routes (must be before /:id to avoid path conflicts)
// ===========================================================================

// POST /api/expenses/split — Create expense group + materialized children
routes.post('/split', zValidator('json', createSplitExpenseSchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const result = await expenseRepository.createExpenseGroup(data, user.id);

  return c.json(
    {
      success: true,
      data: result,
      message: 'Split expense created successfully',
    },
    201
  );
});

// PUT /api/expenses/split/:id — Update split config, regenerate children
routes.put(
  '/split/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSplitSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    const result = await expenseRepository.updateExpenseGroup(id, data, user.id);

    return c.json({
      success: true,
      data: result,
      message: 'Split expense updated successfully',
    });
  }
);

// GET /api/expenses/split/:id — Get group with children
routes.get('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  const result = await expenseRepository.getExpenseGroup(id, user.id);

  return c.json({ success: true, data: result });
});

// DELETE /api/expenses/split/:id — Delete group (cascade children)
routes.delete('/split/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  await expenseRepository.deleteExpenseGroup(id, user.id);

  return c.json({ success: true, message: 'Split expense deleted successfully' });
});

// GET /api/expenses/categories - Get expense categories
routes.get('/categories', async (c) => {
  return c.json({
    success: true,
    data: EXPENSE_CATEGORIES.map((category) => ({
      value: category,
      label: EXPENSE_CATEGORY_LABELS[category],
      description: EXPENSE_CATEGORY_DESCRIPTIONS[category],
    })),
  });
});

// ===========================================================================
// Summary route (must be before /:id to avoid path conflicts)
// ===========================================================================

// GET /api/expenses/vehicle-stats - Per-vehicle expense stats (dashboard)
routes.get(
  '/vehicle-stats',
  zValidator(
    'query',
    z.object({
      recentDays: z
        .string()
        .transform((v) => parseInt(v, 10))
        .pipe(z.number().int().min(1).max(365))
        .optional(),
    })
  ),
  async (c) => {
    const user = c.get('user');
    const { recentDays } = c.req.valid('query');
    const stats = await expenseRepository.getPerVehicleStats(user.id, recentDays);
    return c.json({ success: true, data: stats });
  }
);

const summaryQuerySchema = z.object({
  vehicleId: z.string().optional(),
  period: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().default('all'),
});

// GET /api/expenses/summary - Get expense summary aggregations
routes.get('/summary', zValidator('query', summaryQuerySchema), async (c) => {
  const user = c.get('user');
  const { vehicleId, period } = c.req.valid('query');

  // If vehicleId provided, verify user owns the vehicle
  if (vehicleId) {
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }
  }

  const summary = await expenseRepository.getSummary({
    userId: user.id,
    vehicleId,
    period,
  });

  return c.json({ success: true, data: summary });
});

// POST /api/expenses - Create a new expense
routes.post('/', zValidator('json', createExpenseSchema), async (c) => {
  const user = c.get('user');
  const expenseData = c.req.valid('json');

  // Verify vehicle exists and belongs to user
  const vehicle = await vehicleRepository.findByUserIdAndId(user.id, expenseData.vehicleId);
  if (!vehicle) {
    throw new NotFoundError('Vehicle');
  }

  // Validate: reject financing payment if vehicle has no active financing
  if (expenseData.isFinancingPayment) {
    const financing = await financingRepository.findByVehicleId(expenseData.vehicleId);
    if (!financing || !financing.isActive) {
      throw new ValidationError('Vehicle has no active financing');
    }
  }

  // Validate fuel expense requirements
  validateFuelExpenseData(
    expenseData.category,
    expenseData.mileage,
    expenseData.fuelAmount,
    expenseData.fuelType
  );

  const createdExpense = await expenseRepository.create(expenseData);

  // Adjust financing balance if this is a financing payment
  const updatedFinancing = await handleFinancingOnCreate(createdExpense);

  // Auto-create linked odometer entry if expense has mileage
  await handleOdometerOnExpenseCreate(createdExpense, user.id);

  return c.json(
    {
      success: true,
      data: updatedFinancing
        ? { expense: createdExpense, financing: updatedFinancing }
        : createdExpense,
      message: 'Expense created successfully',
    },
    201
  );
});

// Note: With Drizzle JSON mode, tags are automatically parsed/stringified
// No need for manual JSON.parse/stringify helper functions

// validateFuelExpenseData moved to utils/validation.ts

// GET /api/expenses - Get all expenses for the user (with optional vehicle filter)
routes.get('/', zValidator('query', expenseQuerySchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');

  // If vehicleId filter is provided, verify user owns the vehicle
  if (query.vehicleId) {
    const vehicle = await vehicleRepository.findByUserIdAndId(user.id, query.vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle');
    }
  }

  const { data, totalCount } = await expenseRepository.findPaginated({
    userId: user.id,
    vehicleId: query.vehicleId,
    category: query.category,
    startDate: query.startDate,
    endDate: query.endDate,
    tags: query.tags,
    limit: query.limit,
    offset: query.offset,
  });

  const limit = Math.min(
    query.limit ?? CONFIG.pagination.defaultPageSize,
    CONFIG.pagination.maxPageSize
  );
  const offset = query.offset ?? 0;

  return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
});

// GET /api/expenses/:id - Get specific expense
routes.get('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const expense = await validateExpenseOwnership(id, user.id);
  return c.json({ success: true, data: expense });
});

// PUT /api/expenses/:id - Update expense
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateExpenseSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const updateData = c.req.valid('json');
    const existingExpense = await validateExpenseOwnership(id, user.id);

    const finalCategory =
      updateData.category !== undefined ? updateData.category : existingExpense.category;
    const finalMileage =
      updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;
    const finalFuelAmount =
      updateData.fuelAmount !== undefined ? updateData.fuelAmount : existingExpense.fuelAmount;
    const finalFuelType =
      updateData.fuelType !== undefined ? updateData.fuelType : existingExpense.fuelType;

    validateFuelExpenseData(finalCategory, finalMileage, finalFuelAmount, finalFuelType);

    // Adjust financing balance if financing involvement changed
    const updatedFinancing = await handleFinancingOnUpdate(existingExpense, updateData);

    // Auto-manage linked odometer entry based on mileage changes
    await handleOdometerOnExpenseUpdate(existingExpense, updateData, user.id);

    const updatedExpense = await expenseRepository.update(id, updateData);
    return c.json({
      success: true,
      data: updatedFinancing
        ? { expense: updatedExpense, financing: updatedFinancing }
        : updatedExpense,
      message: 'Expense updated successfully',
    });
  }
);

// DELETE /api/expenses/:id - Delete expense
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const expense = await validateExpenseOwnership(id, user.id);

  // Reverse financing balance adjustment before deleting
  await handleFinancingOnDelete(expense);

  // Delete linked odometer entry if expense has mileage
  await handleOdometerOnExpenseDelete(expense);

  await expenseRepository.delete(id);
  return c.json({ success: true, message: 'Expense deleted successfully' });
});

export { routes };
