import { DatabaseError } from '../../core/errors/';
import type { ExpenseRepository } from '../../repositories/expense';
import type { VehicleRepository } from '../../repositories/vehicle';
import type {
  AnalyticsQuery,
  DashboardAnalytics,
  Expense,
  TrendData,
  Vehicle,
  VehicleAnalytics,
} from '../../types/analytics';
import { logger } from '../../utils/logger';
import { ExpenseCalculator } from './expense-calculator';

export class AnalyticsService {
  private calculator: ExpenseCalculator;

  constructor(
    private expenseRepo: ExpenseRepository,
    private vehicleRepo: VehicleRepository
  ) {
    this.calculator = new ExpenseCalculator();
  }

  async getDashboardAnalytics(userId: string, query: AnalyticsQuery): Promise<DashboardAnalytics> {
    try {
      logger.debug('Fetching dashboard analytics', { userId, query });

      // Get all user vehicles
      const vehicles = await this.vehicleRepo.findByUserId(userId);

      if (vehicles.length === 0) {
        logger.info('No vehicles found for user', { userId });
        return this.getEmptyDashboard();
      }

      // Get expenses for all vehicles with a single query
      const expenses: Expense[] = await this.expenseRepo.find({
        userId,
        startDate: query.startDate,
        endDate: query.endDate,
      });

      logger.debug('Dashboard analytics calculated', {
        userId,
        vehicleCount: vehicles.length,
        expenseCount: expenses.length,
      });

      return {
        vehicles: this.formatVehicles(vehicles),
        totalExpenses: this.calculator.calculateTotal(expenses),
        monthlyExpensesTrends: this.calculator.calculateTrends(expenses, query.groupBy),
        categoryBreakdown: this.calculator.calculateBreakdown(expenses),
        fuelEfficiency: this.calculator.calculateFuelEfficiency(expenses, vehicles),
        costPerMile: this.calculator.calculateCostPerMile(expenses, vehicles),
      };
    } catch (error) {
      logger.error('Failed to get dashboard analytics', {
        userId,
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to calculate dashboard analytics', error);
    }
  }

  async getVehicleAnalytics(
    vehicleId: string,
    vehicle: Vehicle,
    query: AnalyticsQuery
  ): Promise<VehicleAnalytics> {
    try {
      logger.debug('Fetching vehicle analytics', { vehicleId, query });

      // Get vehicle expenses
      const expenses: Expense[] = await this.expenseRepo.find({
        vehicleId,
        startDate: query.startDate,
        endDate: query.endDate,
      });

      const totalExpenses = this.calculator.calculateTotal(expenses);
      const monthlyTrends = this.calculator.calculateTrends(expenses, query.groupBy);
      const categoryBreakdown = this.calculator.calculateBreakdown(expenses);

      // Fuel efficiency for this vehicle
      const fuelExpenses = expenses.filter((e) => e.category === 'fuel');
      const fuelEfficiency = this.calculator.calculateFuelEfficiencyForVehicle(
        fuelExpenses,
        vehicle.initialMileage || 0
      );

      // Cost per mile for this vehicle
      const costPerMile = this.calculator.calculateCostPerMileForVehicle(
        expenses,
        vehicle.initialMileage || 0
      );

      logger.debug('Vehicle analytics calculated', {
        vehicleId,
        expenseCount: expenses.length,
      });

      return {
        vehicle: {
          id: vehicle.id,
          name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          nickname: vehicle.nickname,
        },
        totalExpenses,
        monthlyTrends,
        categoryBreakdown,
        fuelEfficiency,
        costPerMile,
      };
    } catch (error) {
      logger.error('Failed to get vehicle analytics', {
        vehicleId,
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to calculate vehicle analytics', error);
    }
  }

  async getTrendData(userId: string, query: AnalyticsQuery): Promise<TrendData> {
    try {
      logger.debug('Fetching trend data', { userId, query });

      // Get all user vehicles
      const vehicles = await this.vehicleRepo.findByUserId(userId);

      // Get expenses for all vehicles with a single query
      const expenses: Expense[] = await this.expenseRepo.find({
        userId,
        startDate: query.startDate,
        endDate: query.endDate,
      });

      // Calculate trend data
      const costTrends = this.calculator.calculateTrends(expenses, query.groupBy);
      const fuelExpenses = expenses.filter((e) => e.category === 'fuel' && e.mileage);
      const milesTrends = this.calculator.calculateMilesTrends(fuelExpenses, query.groupBy);
      const costPerMileTrends = this.calculator.calculateCostPerMileTrends(expenses, query.groupBy);

      logger.debug('Trend data calculated', {
        userId,
        vehicleCount: vehicles.length,
        expenseCount: expenses.length,
      });

      return {
        costTrends,
        milesTrends,
        costPerMileTrends,
      };
    } catch (error) {
      logger.error('Failed to get trend data', {
        userId,
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to calculate trend data', error);
    }
  }

  private formatVehicles(vehicles: Vehicle[]) {
    return vehicles.map((v) => ({
      id: v.id,
      name: `${v.year} ${v.make} ${v.model}`,
      nickname: v.nickname,
    }));
  }

  private getEmptyDashboard(): DashboardAnalytics {
    return {
      vehicles: [],
      totalExpenses: 0,
      monthlyExpensesTrends: [],
      categoryBreakdown: {},
      fuelEfficiency: {
        averageMPG: 0,
        totalVolume: 0,
        totalFuelCost: 0,
        averageCostPerGallon: 0,
      },
      costPerMile: {
        totalCostPerMile: 0,
        totalCost: 0,
        totalMiles: 0,
      },
    };
  }
}
