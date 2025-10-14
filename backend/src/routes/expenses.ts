import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';
import type { NewExpense } from '../db/schema';
import type { ExpenseType, ExpenseCategory } from '../types/index';

const expenses = new Hono();

// Validation schemas
const expenseTypeSchema = z.enum([
  // Operating Costs
  'fuel', 'tolls', 'parking',
  // Maintenance & Repairs
  'maintenance', 'repairs', 'tires', 'oil-change',
  // Financial
  'insurance', 'loan-payment',
  // Regulatory/Legal
  'registration', 'inspection', 'emissions', 'tickets',
  // Enhancements/Modifications
  'modifications', 'accessories', 'detailing',
  // Other
  'other'
]);

const expenseCategorySchema = z.enum([
  'operating',     // Day-to-day driving costs (fuel, tolls, parking)
  'maintenance',   // Keeping the car running (oil, repairs, tires)
  'financial',    // Loans, insurance
  'regulatory',   // Government-required (registration, inspection, tickets)
  'enhancement',  // Optional improvements (tint, accessories, detailing)
  'convenience'   // Nice-to-have (vanity plates, car washes)
]);

const createExpenseSchema = z.object({
  type: expenseTypeSchema,
  category: expenseCategorySchema,
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency must be 3 characters').default('USD'),
  date: z.string().datetime().transform((val) => new Date(val)),
  mileage: z.number().int().min(0, 'Mileage cannot be negative').optional(),
  gallons: z.number().positive('Gallons must be positive').optional(),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  receiptUrl: z.string().url('Receipt URL must be valid').optional(),
});

const updateExpenseSchema = createExpenseSchema.partial();

const expenseParamsSchema = z.object({
  id: z.string().min(1, 'Expense ID is required'),
});

const vehicleParamsSchema = z.object({
  id: z.string().min(1, 'Vehicle ID is required'),
});

const expenseQuerySchema = z.object({
  type: expenseTypeSchema.optional(),
  category: expenseCategorySchema.optional(),
  startDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  endDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  limit: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()).optional(),
  offset: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().min(0)).optional(),
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
        'fuel', 'tolls', 'parking',
        // Maintenance & Repairs
        'maintenance', 'repairs', 'tires', 'oil-change',
        // Financial
        'insurance', 'loan-payment',
        // Regulatory/Legal
        'registration', 'inspection', 'emissions', 'tickets',
        // Enhancements/Modifications
        'modifications', 'accessories', 'detailing',
        // Other
        'other'
      ],
      categories: [
        'operating',     // Day-to-day driving costs (fuel, tolls, parking)
        'maintenance',   // Keeping the car running (oil, repairs, tires)
        'financial',    // Loans, insurance
        'regulatory',   // Government-required (registration, inspection, tickets)
        'enhancement',  // Optional improvements (tint, accessories, detailing)
        'convenience'   // Nice-to-have (vanity plates, car washes)
      ],
      categoryMapping: {
        operating: ['fuel', 'tolls', 'parking'],
        maintenance: ['maintenance', 'repairs', 'tires', 'oil-change'],
        financial: ['insurance', 'loan-payment'],
        regulatory: ['registration', 'inspection', 'emissions', 'tickets'],
        enhancement: ['modifications', 'accessories', 'detailing'],
        convenience: ['other']
      }
    }
  });
});

// POST /api/expenses/vehicles/:id/expenses - Add expense to vehicle
expenses.post('/vehicles/:id/expenses', 
  zValidator('param', vehicleParamsSchema),
  zValidator('json', createExpenseSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id: vehicleId } = c.req.valid('param');
      const expenseData = c.req.valid('json');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }
      
      // Validate fuel expense requirements
      if (expenseData.type === 'fuel') {
        if (!expenseData.gallons || !expenseData.mileage) {
          throw new HTTPException(400, { 
            message: 'Fuel expenses require both gallons and mileage data' 
          });
        }
      }
      
      const newExpense: NewExpense = {
        ...expenseData,
        vehicleId,
      };
      
      const createdExpense = await expenseRepository.create(newExpense);
      
      return c.json({
        success: true,
        data: createdExpense,
        message: 'Expense created successfully',
      }, 201);
    } catch (error) {
      console.error('Error creating expense:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to create expense' });
    }
  }
);

// GET /api/expenses/vehicles/:id/expenses - Get vehicle expenses
expenses.get('/vehicles/:id/expenses',
  zValidator('param', vehicleParamsSchema),
  zValidator('query', expenseQuerySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id: vehicleId } = c.req.valid('param');
      const query = c.req.valid('query');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }
      
      let vehicleExpenses;
      
      // Apply filters based on query parameters
      if (query.startDate && query.endDate) {
        vehicleExpenses = await expenseRepository.findByVehicleIdAndDateRange(
          vehicleId, 
          query.startDate, 
          query.endDate
        );
      } else if (query.type) {
        vehicleExpenses = await expenseRepository.findByType(vehicleId, query.type);
      } else if (query.category) {
        vehicleExpenses = await expenseRepository.findByCategory(vehicleId, query.category);
      } else {
        vehicleExpenses = await expenseRepository.findByVehicleId(vehicleId);
      }
      
      // Apply pagination if specified
      if (query.limit || query.offset) {
        const offset = query.offset || 0;
        const limit = query.limit || 50;
        vehicleExpenses = vehicleExpenses.slice(offset, offset + limit);
      }
      
      return c.json({
        success: true,
        data: vehicleExpenses,
        count: vehicleExpenses.length,
        filters: {
          type: query.type,
          category: query.category,
          startDate: query.startDate,
          endDate: query.endDate,
        }
      });
    } catch (error) {
      console.error('Error fetching vehicle expenses:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to fetch vehicle expenses' });
    }
  }
);

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
expenses.put('/:id',
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
      
      // Validate fuel expense requirements if updating to fuel type
      if (updateData.type === 'fuel' || existingExpense.type === 'fuel') {
        const finalType = updateData.type || existingExpense.type;
        const finalGallons = updateData.gallons !== undefined ? updateData.gallons : existingExpense.gallons;
        const finalMileage = updateData.mileage !== undefined ? updateData.mileage : existingExpense.mileage;
        
        if (finalType === 'fuel' && (!finalGallons || !finalMileage)) {
          throw new HTTPException(400, { 
            message: 'Fuel expenses require both gallons and mileage data' 
          });
        }
      }
      
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

// GET /api/expenses/vehicles/:id/fuel-efficiency - Get fuel efficiency data
expenses.get('/vehicles/:id/fuel-efficiency',
  zValidator('param', vehicleParamsSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id: vehicleId } = c.req.valid('param');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }
      
      // Get all fuel expenses for the vehicle
      const fuelExpenses = await expenseRepository.findFuelExpenses(vehicleId);
      
      // Calculate MPG and efficiency metrics
      const efficiencyData = calculateFuelEfficiency(fuelExpenses, vehicle.initialMileage || 0);
      
      return c.json({
        success: true,
        data: {
          vehicleId,
          totalFuelExpenses: fuelExpenses.length,
          averageMPG: efficiencyData.averageMPG,
          totalGallons: efficiencyData.totalGallons,
          totalMiles: efficiencyData.totalMiles,
          averageCostPerGallon: efficiencyData.averageCostPerGallon,
          averageCostPerMile: efficiencyData.averageCostPerMile,
          efficiencyTrend: efficiencyData.trend,
          alerts: efficiencyData.alerts,
        }
      });
    } catch (error) {
      console.error('Error fetching fuel efficiency:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to fetch fuel efficiency data' });
    }
  }
);

// GET /api/expenses/vehicles/:id/cost-per-mile - Get cost per mile analysis
expenses.get('/vehicles/:id/cost-per-mile',
  zValidator('param', vehicleParamsSchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { id: vehicleId } = c.req.valid('param');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }
      
      // Get all expenses for the vehicle
      const allExpenses = await expenseRepository.findByVehicleId(vehicleId);
      
      // Calculate cost per mile metrics
      const costPerMileData = calculateCostPerMile(allExpenses, vehicle.initialMileage || 0);
      
      return c.json({
        success: true,
        data: costPerMileData
      });
    } catch (error) {
      console.error('Error calculating cost per mile:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to calculate cost per mile' });
    }
  }
);

// Helper functions for fuel efficiency calculations
function calculateFuelEfficiency(fuelExpenses: any[], initialMileage: number) {
  if (fuelExpenses.length === 0) {
    return {
      averageMPG: 0,
      totalGallons: 0,
      totalMiles: 0,
      averageCostPerGallon: 0,
      averageCostPerMile: 0,
      trend: [],
      alerts: []
    };
  }

  // Sort by date to calculate trends
  const sortedExpenses = fuelExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  let totalGallons = 0;
  let totalCost = 0;
  let mpgReadings: number[] = [];
  let trend: any[] = [];
  let alerts: any[] = [];
  let previousMileage = initialMileage;

  sortedExpenses.forEach((expense, index) => {
    if (expense.gallons && expense.mileage) {
      const milesDriven = expense.mileage - previousMileage;
      const mpg = milesDriven > 0 ? milesDriven / expense.gallons : 0;
      
      if (mpg > 0 && mpg < 100) { // Reasonable MPG range
        mpgReadings.push(mpg);
        
        trend.push({
          date: expense.date,
          mpg: Math.round(mpg * 100) / 100,
          mileage: expense.mileage,
          gallons: expense.gallons,
          costPerGallon: Math.round((expense.amount / expense.gallons) * 100) / 100
        });

        // Check for efficiency alerts (significant MPG drop)
        if (index > 0 && mpgReadings.length > 1) {
          const recentAverage = mpgReadings.slice(-3).reduce((sum, val) => sum + val, 0) / Math.min(3, mpgReadings.length);
          const overallAverage = mpgReadings.slice(0, -1).reduce((sum, val) => sum + val, 0) / (mpgReadings.length - 1); // Exclude current reading
          
          if (mpg < overallAverage * 0.85) { // 15% drop from average
            alerts.push({
              type: 'efficiency_drop',
              date: expense.date,
              message: `Fuel efficiency dropped to ${mpg.toFixed(1)} MPG (${((overallAverage - mpg) / overallAverage * 100).toFixed(1)}% below average)`,
              severity: mpg < overallAverage * 0.7 ? 'high' : 'medium',
              currentMPG: Math.round(mpg * 100) / 100,
              averageMPG: Math.round(overallAverage * 100) / 100
            });
          }
        }
      }
      
      totalGallons += expense.gallons;
      totalCost += expense.amount;
      previousMileage = expense.mileage;
    }
  });

  const totalMiles = previousMileage - initialMileage;
  const averageMPG = totalGallons > 0 ? totalMiles / totalGallons : 0;
  const averageCostPerGallon = totalGallons > 0 ? totalCost / totalGallons : 0;
  const averageCostPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;

  return {
    averageMPG: Math.round(averageMPG * 100) / 100,
    totalGallons: Math.round(totalGallons * 100) / 100,
    totalMiles,
    averageCostPerGallon: Math.round(averageCostPerGallon * 100) / 100,
    averageCostPerMile: Math.round(averageCostPerMile * 100) / 100,
    trend,
    alerts
  };
}

function calculateCostPerMile(allExpenses: any[], initialMileage: number) {
  if (allExpenses.length === 0) {
    return {
      totalCostPerMile: 0,
      categoryBreakdown: {},
      monthlyTrends: [],
      currentMileage: initialMileage
    };
  }

  // Find the highest mileage to calculate total miles driven
  const expensesWithMileage = allExpenses.filter(e => e.mileage && e.mileage > 0);
  const maxMileage = expensesWithMileage.length > 0 
    ? Math.max(...expensesWithMileage.map(e => e.mileage))
    : initialMileage;
  const totalMiles = maxMileage - initialMileage;
  
  if (totalMiles <= 0) {
    return {
      totalCostPerMile: 0,
      categoryBreakdown: {},
      monthlyTrends: [],
      currentMileage: maxMileage
    };
  }

  // Calculate total cost and breakdown by category
  let totalCost = 0;
  const categoryBreakdown: { [key: string]: { cost: number; costPerMile: number } } = {};

  allExpenses.forEach(expense => {
    totalCost += expense.amount;
    
    if (!categoryBreakdown[expense.category]) {
      categoryBreakdown[expense.category] = { cost: 0, costPerMile: 0 };
    }
    categoryBreakdown[expense.category].cost += expense.amount;
  });

  // Calculate cost per mile for each category
  Object.keys(categoryBreakdown).forEach(category => {
    categoryBreakdown[category].costPerMile = Math.round((categoryBreakdown[category].cost / totalMiles) * 100) / 100;
    categoryBreakdown[category].cost = Math.round(categoryBreakdown[category].cost * 100) / 100;
  });

  // Calculate monthly trends
  const monthlyData: { [key: string]: { cost: number; miles: number } } = {};
  
  allExpenses.forEach(expense => {
    const monthKey = new Date(expense.date).toISOString().substring(0, 7); // YYYY-MM
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { cost: 0, miles: 0 };
    }
    monthlyData[monthKey].cost += expense.amount;
  });

  // Estimate miles per month (simplified - could be improved with more data)
  const months = Object.keys(monthlyData).length;
  const avgMilesPerMonth = months > 0 ? totalMiles / months : 0;

  const monthlyTrends = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      cost: Math.round(data.cost * 100) / 100,
      estimatedMiles: Math.round(avgMilesPerMonth),
      costPerMile: avgMilesPerMonth > 0 ? Math.round((data.cost / avgMilesPerMonth) * 100) / 100 : 0
    }));

  return {
    totalCostPerMile: Math.round((totalCost / totalMiles) * 100) / 100,
    categoryBreakdown,
    monthlyTrends,
    currentMileage: maxMileage,
    totalMiles,
    totalCost: Math.round(totalCost * 100) / 100
  };
}

export { expenses };