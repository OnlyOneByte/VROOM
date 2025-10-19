import type { IExpenseRepository, IVehicleRepository } from '../../repositories/interfaces';
import { CostCalculator } from './cost-calculator';
import { DashboardCalculator } from './dashboard-calculator';
import { FuelEfficiencyCalculator } from './fuel-efficiency-calculator';
import { TrendCalculator } from './trend-calculator';
import type {
  AnalyticsQuery,
  DashboardAnalytics,
  ExpenseData,
  TrendData,
  VehicleAnalytics,
  VehicleData,
} from './types';

export class AnalyticsService {
  private dashboardCalc: DashboardCalculator;
  private trendCalc: TrendCalculator;
  private fuelEfficiencyCalc: FuelEfficiencyCalculator;
  private costCalc: CostCalculator;

  constructor(
    private expenseRepo: IExpenseRepository,
    private vehicleRepo: IVehicleRepository
  ) {
    this.dashboardCalc = new DashboardCalculator();
    this.trendCalc = new TrendCalculator();
    this.fuelEfficiencyCalc = new FuelEfficiencyCalculator();
    this.costCalc = new CostCalculator();
  }

  async getDashboardAnalytics(userId: string, query: AnalyticsQuery): Promise<DashboardAnalytics> {
    // Get all user vehicles
    const vehicles = await this.vehicleRepo.findByUserId(userId);

    if (vehicles.length === 0) {
      return this.getEmptyDashboard();
    }

    // Get expenses for all vehicles with a single query
    const expenses: ExpenseData[] =
      query.startDate && query.endDate
        ? await this.expenseRepo.findByUserIdAndDateRange(userId, query.startDate, query.endDate)
        : await this.expenseRepo.findByUserId(userId);

    return {
      vehicles: this.formatVehicles(vehicles),
      totalExpenses: this.dashboardCalc.calculateTotal(expenses),
      monthlyTrends: this.trendCalc.calculate(expenses, query.groupBy),
      categoryBreakdown: this.dashboardCalc.calculateBreakdown(expenses),
      fuelEfficiency: this.dashboardCalc.calculateFuelEfficiency(expenses, vehicles),
      costPerMile: this.dashboardCalc.calculateCostPerMile(expenses, vehicles),
    };
  }

  async getVehicleAnalytics(
    vehicleId: string,
    vehicle: VehicleData,
    query: AnalyticsQuery
  ): Promise<VehicleAnalytics> {
    // Get vehicle expenses
    const expenses: ExpenseData[] =
      query.startDate && query.endDate
        ? await this.expenseRepo.findByVehicleIdAndDateRange(
            vehicleId,
            query.startDate,
            query.endDate
          )
        : await this.expenseRepo.findByVehicleId(vehicleId);

    const totalExpenses = this.dashboardCalc.calculateTotal(expenses);
    const monthlyTrends = this.trendCalc.calculate(expenses, query.groupBy);
    const categoryBreakdown = this.dashboardCalc.calculateBreakdown(expenses);

    // Fuel efficiency for this vehicle
    const fuelExpenses = expenses.filter((e) => e.category === 'fuel');
    const fuelEfficiency = this.fuelEfficiencyCalc.calculateForVehicle(
      fuelExpenses,
      vehicle.initialMileage || 0
    );

    // Cost per mile for this vehicle
    const costPerMile = this.costCalc.calculateCostPerMileForVehicle(
      expenses,
      vehicle.initialMileage || 0
    );

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
  }

  async getTrendData(userId: string, query: AnalyticsQuery): Promise<TrendData> {
    // Get all user vehicles
    const vehicles = await this.vehicleRepo.findByUserId(userId);

    // Get expenses for all vehicles with a single query
    const expenses: ExpenseData[] =
      query.startDate && query.endDate
        ? await this.expenseRepo.findByUserIdAndDateRange(userId, query.startDate, query.endDate)
        : await this.expenseRepo.findByUserId(userId);

    // Add vehicle names to expenses
    const vehicleMap = new Map(vehicles.map((v) => [v.id, `${v.year} ${v.make} ${v.model}`]));
    const expensesWithVehicleNames = expenses.map((e) => ({
      ...e,
      vehicleName: vehicleMap.get(e.vehicleId) || 'Unknown Vehicle',
    }));

    // Calculate trend data
    const costTrends = this.trendCalc.calculate(expensesWithVehicleNames, query.groupBy);
    const fuelExpenses = expensesWithVehicleNames.filter((e) => e.type === 'fuel' && e.mileage);
    const milesTrends = this.trendCalc.calculateMilesTrends(fuelExpenses, query.groupBy);
    const costPerMileTrends = this.trendCalc.calculateCostPerMileTrends(
      expensesWithVehicleNames,
      query.groupBy
    );

    return {
      costTrends,
      milesTrends,
      costPerMileTrends,
    };
  }

  private formatVehicles(vehicles: VehicleData[]) {
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
      monthlyTrends: [],
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
