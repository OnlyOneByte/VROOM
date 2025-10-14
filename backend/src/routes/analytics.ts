import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../lib/middleware/auth';
import { repositoryFactory } from '../lib/repositories/factory';

const analytics = new Hono();

// Validation schemas
const analyticsParamsSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required').optional(),
});

const analyticsQuerySchema = z.object({
  startDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  endDate: z.string().datetime().optional().transform((val) => val ? new Date(val) : undefined),
  groupBy: z.enum(['day', 'week', 'month', 'year']).default('month'),
});

// Apply authentication to all routes
analytics.use('*', requireAuth);

// GET /api/analytics/dashboard - Get comprehensive dashboard data
analytics.get('/dashboard',
  zValidator('query', analyticsQuerySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const query = c.req.valid('query');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Get all user vehicles
      const userVehicles = await vehicleRepository.findByUserId(user.id);
      
      if (userVehicles.length === 0) {
        return c.json({
          success: true,
          data: {
            vehicles: [],
            totalExpenses: 0,
            monthlyTrends: [],
            categoryBreakdown: {},
            fuelEfficiency: {},
            costPerMile: {}
          }
        });
      }
      
      // Get expenses for all vehicles
      let allExpenses: any[] = [];
      for (const vehicle of userVehicles) {
        const vehicleExpenses = query.startDate && query.endDate
          ? await expenseRepository.findByVehicleIdAndDateRange(vehicle.id, query.startDate, query.endDate)
          : await expenseRepository.findByVehicleId(vehicle.id);
        allExpenses = allExpenses.concat(vehicleExpenses);
      }
      
      // Calculate analytics data
      const dashboardData = calculateDashboardAnalytics(allExpenses, userVehicles, query.groupBy);
      
      return c.json({
        success: true,
        data: dashboardData
      });
    } catch (error) {
      console.error('Error fetching dashboard analytics:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to fetch dashboard analytics' });
    }
  }
);

// GET /api/analytics/vehicle/:vehicleId - Get analytics for specific vehicle
analytics.get('/vehicle/:vehicleId',
  zValidator('param', z.object({ vehicleId: z.string() })),
  zValidator('query', analyticsQuerySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const { vehicleId } = c.req.valid('param');
      const query = c.req.valid('query');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Verify vehicle exists and belongs to user
      const vehicle = await vehicleRepository.findByUserIdAndId(user.id, vehicleId);
      if (!vehicle) {
        throw new HTTPException(404, { message: 'Vehicle not found' });
      }
      
      // Get vehicle expenses
      const vehicleExpenses = query.startDate && query.endDate
        ? await expenseRepository.findByVehicleIdAndDateRange(vehicleId, query.startDate, query.endDate)
        : await expenseRepository.findByVehicleId(vehicleId);
      
      // Calculate vehicle-specific analytics
      const vehicleAnalytics = calculateVehicleAnalytics(vehicleExpenses, vehicle, query.groupBy);
      
      return c.json({
        success: true,
        data: vehicleAnalytics
      });
    } catch (error) {
      console.error('Error fetching vehicle analytics:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to fetch vehicle analytics' });
    }
  }
);

// GET /api/analytics/trends - Get trend data for charts
analytics.get('/trends',
  zValidator('query', analyticsQuerySchema),
  async (c) => {
    try {
      const user = c.get('user');
      const query = c.req.valid('query');
      
      const vehicleRepository = repositoryFactory.getVehicleRepository();
      const expenseRepository = repositoryFactory.getExpenseRepository();
      
      // Get all user vehicles
      const userVehicles = await vehicleRepository.findByUserId(user.id);
      
      // Get expenses for all vehicles
      let allExpenses: any[] = [];
      for (const vehicle of userVehicles) {
        const vehicleExpenses = query.startDate && query.endDate
          ? await expenseRepository.findByVehicleIdAndDateRange(vehicle.id, query.startDate, query.endDate)
          : await expenseRepository.findByVehicleId(vehicle.id);
        allExpenses = allExpenses.concat(vehicleExpenses.map(e => ({ ...e, vehicleName: `${vehicle.year} ${vehicle.make} ${vehicle.model}` })));
      }
      
      // Calculate trend data
      const trendData = calculateTrendData(allExpenses, query.groupBy);
      
      return c.json({
        success: true,
        data: trendData
      });
    } catch (error) {
      console.error('Error fetching trend data:', error);
      
      if (error instanceof HTTPException) {
        throw error;
      }
      
      throw new HTTPException(500, { message: 'Failed to fetch trend data' });
    }
  }
);

// Helper functions
function calculateDashboardAnalytics(expenses: any[], vehicles: any[], groupBy: string) {
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  
  // Monthly trends
  const monthlyTrends = calculateMonthlyTrends(expenses, groupBy);
  
  // Category breakdown
  const categoryBreakdown = calculateCategoryBreakdown(expenses);
  
  // Fuel efficiency summary
  const fuelEfficiency = calculateOverallFuelEfficiency(expenses, vehicles);
  
  // Cost per mile summary
  const costPerMile = calculateOverallCostPerMile(expenses, vehicles);
  
  return {
    vehicles: vehicles.map(v => ({
      id: v.id,
      name: `${v.year} ${v.make} ${v.model}`,
      nickname: v.nickname
    })),
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    monthlyTrends,
    categoryBreakdown,
    fuelEfficiency,
    costPerMile
  };
}

function calculateVehicleAnalytics(expenses: any[], vehicle: any, groupBy: string) {
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  
  // Monthly trends for this vehicle
  const monthlyTrends = calculateMonthlyTrends(expenses, groupBy);
  
  // Category breakdown for this vehicle
  const categoryBreakdown = calculateCategoryBreakdown(expenses);
  
  // Fuel efficiency for this vehicle
  const fuelExpenses = expenses.filter(e => e.type === 'fuel');
  const fuelEfficiency = calculateFuelEfficiencyForVehicle(fuelExpenses, vehicle.initialMileage || 0);
  
  // Cost per mile for this vehicle
  const costPerMile = calculateCostPerMileForVehicle(expenses, vehicle.initialMileage || 0);
  
  return {
    vehicle: {
      id: vehicle.id,
      name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      nickname: vehicle.nickname
    },
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    monthlyTrends,
    categoryBreakdown,
    fuelEfficiency,
    costPerMile
  };
}

function calculateMonthlyTrends(expenses: any[], groupBy: string) {
  const trends: { [key: string]: number } = {};
  
  expenses.forEach(expense => {
    let dateKey: string;
    const date = new Date(expense.date);
    
    switch (groupBy) {
      case 'day':
        dateKey = date.toISOString().substring(0, 10); // YYYY-MM-DD
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        dateKey = weekStart.toISOString().substring(0, 10);
        break;
      case 'month':
        dateKey = date.toISOString().substring(0, 7); // YYYY-MM
        break;
      case 'year':
        dateKey = date.getFullYear().toString();
        break;
      default:
        dateKey = date.toISOString().substring(0, 7);
    }
    
    trends[dateKey] = (trends[dateKey] || 0) + expense.amount;
  });
  
  return Object.entries(trends)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, amount]) => ({
      period,
      amount: Math.round(amount * 100) / 100
    }));
}

function calculateCategoryBreakdown(expenses: any[]) {
  const breakdown: { [key: string]: { amount: number; count: number; percentage: number } } = {};
  const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  
  expenses.forEach(expense => {
    if (!breakdown[expense.category]) {
      breakdown[expense.category] = { amount: 0, count: 0, percentage: 0 };
    }
    breakdown[expense.category].amount += expense.amount;
    breakdown[expense.category].count += 1;
  });
  
  // Calculate percentages
  Object.keys(breakdown).forEach(category => {
    breakdown[category].amount = Math.round(breakdown[category].amount * 100) / 100;
    breakdown[category].percentage = totalAmount > 0 
      ? Math.round((breakdown[category].amount / totalAmount) * 10000) / 100 
      : 0;
  });
  
  return breakdown;
}

function calculateOverallFuelEfficiency(expenses: any[], vehicles: any[]) {
  const fuelExpenses = expenses.filter(e => e.type === 'fuel');
  
  if (fuelExpenses.length === 0) {
    return {
      averageMPG: 0,
      totalGallons: 0,
      totalFuelCost: 0,
      averageCostPerGallon: 0
    };
  }
  
  let totalGallons = 0;
  let totalFuelCost = 0;
  let totalMiles = 0;
  
  // Group by vehicle to calculate miles driven
  const vehicleData: { [key: string]: { expenses: any[], initialMileage: number } } = {};
  
  vehicles.forEach(vehicle => {
    vehicleData[vehicle.id] = {
      expenses: fuelExpenses.filter(e => e.vehicleId === vehicle.id),
      initialMileage: vehicle.initialMileage || 0
    };
  });
  
  Object.values(vehicleData).forEach(({ expenses: vehicleFuelExpenses, initialMileage }) => {
    if (vehicleFuelExpenses.length > 0) {
      const sortedExpenses = vehicleFuelExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const maxMileage = Math.max(...sortedExpenses.map(e => e.mileage || 0));
      const vehicleMiles = maxMileage - initialMileage;
      
      totalMiles += vehicleMiles;
      totalGallons += vehicleFuelExpenses.reduce((sum, e) => sum + (e.gallons || 0), 0);
      totalFuelCost += vehicleFuelExpenses.reduce((sum, e) => sum + e.amount, 0);
    }
  });
  
  const averageMPG = totalGallons > 0 ? totalMiles / totalGallons : 0;
  const averageCostPerGallon = totalGallons > 0 ? totalFuelCost / totalGallons : 0;
  
  return {
    averageMPG: Math.round(averageMPG * 100) / 100,
    totalGallons: Math.round(totalGallons * 100) / 100,
    totalFuelCost: Math.round(totalFuelCost * 100) / 100,
    averageCostPerGallon: Math.round(averageCostPerGallon * 100) / 100
  };
}

function calculateOverallCostPerMile(expenses: any[], vehicles: any[]) {
  let totalCost = 0;
  let totalMiles = 0;
  
  vehicles.forEach(vehicle => {
    const vehicleExpenses = expenses.filter(e => e.vehicleId === vehicle.id);
    const expensesWithMileage = vehicleExpenses.filter(e => e.mileage && e.mileage > 0);
    
    if (expensesWithMileage.length > 0) {
      const maxMileage = Math.max(...expensesWithMileage.map(e => e.mileage));
      const vehicleMiles = maxMileage - (vehicle.initialMileage || 0);
      const vehicleCost = vehicleExpenses.reduce((sum, e) => sum + e.amount, 0);
      
      totalMiles += vehicleMiles;
      totalCost += vehicleCost;
    }
  });
  
  const costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;
  
  return {
    totalCostPerMile: Math.round(costPerMile * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalMiles
  };
}

function calculateFuelEfficiencyForVehicle(fuelExpenses: any[], initialMileage: number) {
  if (fuelExpenses.length === 0) {
    return {
      averageMPG: 0,
      totalGallons: 0,
      totalMiles: 0,
      trend: []
    };
  }
  
  const sortedExpenses = fuelExpenses.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  let totalGallons = 0;
  let previousMileage = initialMileage;
  const trend: any[] = [];
  
  sortedExpenses.forEach(expense => {
    if (expense.gallons && expense.mileage) {
      const milesDriven = expense.mileage - previousMileage;
      const mpg = milesDriven > 0 ? milesDriven / expense.gallons : 0;
      
      if (mpg > 0 && mpg < 100) {
        trend.push({
          date: expense.date,
          mpg: Math.round(mpg * 100) / 100,
          mileage: expense.mileage
        });
      }
      
      totalGallons += expense.gallons;
      previousMileage = expense.mileage;
    }
  });
  
  const totalMiles = previousMileage - initialMileage;
  const averageMPG = totalGallons > 0 ? totalMiles / totalGallons : 0;
  
  return {
    averageMPG: Math.round(averageMPG * 100) / 100,
    totalGallons: Math.round(totalGallons * 100) / 100,
    totalMiles,
    trend
  };
}

function calculateCostPerMileForVehicle(expenses: any[], initialMileage: number) {
  const expensesWithMileage = expenses.filter(e => e.mileage && e.mileage > 0);
  
  if (expensesWithMileage.length === 0) {
    return {
      costPerMile: 0,
      totalCost: 0,
      totalMiles: 0
    };
  }
  
  const maxMileage = Math.max(...expensesWithMileage.map(e => e.mileage));
  const totalMiles = maxMileage - initialMileage;
  const totalCost = expenses.reduce((sum, e) => sum + e.amount, 0);
  
  const costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;
  
  return {
    costPerMile: Math.round(costPerMile * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalMiles
  };
}

function calculateTrendData(expenses: any[], groupBy: string) {
  // Cost per month trends
  const costTrends = calculateMonthlyTrends(expenses, groupBy);
  
  // Miles per month (estimated from fuel expenses)
  const fuelExpenses = expenses.filter(e => e.type === 'fuel' && e.mileage);
  const milesTrends = calculateMilesTrends(fuelExpenses, groupBy);
  
  // Cost per mile trends
  const costPerMileTrends = calculateCostPerMileTrends(expenses, groupBy);
  
  return {
    costTrends,
    milesTrends,
    costPerMileTrends
  };
}

function calculateMilesTrends(fuelExpenses: any[], groupBy: string) {
  const trends: { [key: string]: { miles: number, count: number } } = {};
  
  fuelExpenses.forEach(expense => {
    let dateKey: string;
    const date = new Date(expense.date);
    
    switch (groupBy) {
      case 'day':
        dateKey = date.toISOString().substring(0, 10);
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        dateKey = weekStart.toISOString().substring(0, 10);
        break;
      case 'month':
        dateKey = date.toISOString().substring(0, 7);
        break;
      case 'year':
        dateKey = date.getFullYear().toString();
        break;
      default:
        dateKey = date.toISOString().substring(0, 7);
    }
    
    if (!trends[dateKey]) {
      trends[dateKey] = { miles: 0, count: 0 };
    }
    
    // Estimate miles from gallons and average MPG (rough calculation)
    const estimatedMiles = (expense.gallons || 0) * 25; // Assume 25 MPG average
    trends[dateKey].miles += estimatedMiles;
    trends[dateKey].count += 1;
  });
  
  return Object.entries(trends)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({
      period,
      miles: Math.round(data.miles)
    }));
}

function calculateCostPerMileTrends(expenses: any[], groupBy: string) {
  const costTrends = calculateMonthlyTrends(expenses, groupBy);
  const fuelExpenses = expenses.filter(e => e.type === 'fuel' && e.mileage);
  const milesTrends = calculateMilesTrends(fuelExpenses, groupBy);
  
  // Combine cost and miles data
  const costPerMileTrends = costTrends.map(costData => {
    const milesData = milesTrends.find(m => m.period === costData.period);
    const miles = milesData ? milesData.miles : 0;
    const costPerMile = miles > 0 ? costData.amount / miles : 0;
    
    return {
      period: costData.period,
      costPerMile: Math.round(costPerMile * 100) / 100
    };
  });
  
  return costPerMileTrends;
}

export { analytics };