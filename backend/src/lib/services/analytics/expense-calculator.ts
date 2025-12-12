import type { Expense, Vehicle } from '../../../db/schema';

/**
 * Consolidated calculator for all expense-related analytics
 */
export class ExpenseCalculator {
  /**
   * Calculate total expenses
   */
  calculateTotal(expenses: Expense[]): number {
    const total = expenses.reduce((sum, expense) => sum + expense.expenseAmount, 0);
    return Math.round(total * 100) / 100;
  }

  /**
   * Calculate category breakdown with amounts, counts, and percentages
   */
  calculateBreakdown(expenses: Expense[]) {
    const breakdown: { [key: string]: { amount: number; count: number; percentage: number } } = {};
    const totalAmount = expenses.reduce((sum, expense) => sum + expense.expenseAmount, 0);

    expenses.forEach((expense) => {
      if (!breakdown[expense.category]) {
        breakdown[expense.category] = { amount: 0, count: 0, percentage: 0 };
      }
      breakdown[expense.category].amount += expense.expenseAmount;
      breakdown[expense.category].count += 1;
    });

    // Calculate percentages
    Object.keys(breakdown).forEach((category) => {
      breakdown[category].amount = Math.round(breakdown[category].amount * 100) / 100;
      breakdown[category].percentage =
        totalAmount > 0 ? Math.round((breakdown[category].amount / totalAmount) * 10000) / 100 : 0;
    });

    return breakdown;
  }

  /**
   * Calculate trends grouped by time period
   */
  calculateTrends(expenses: Expense[], groupBy: 'day' | 'week' | 'month' | 'year') {
    const trends: { [key: string]: number } = {};

    expenses.forEach((expense) => {
      const dateKey = this.getDateKey(expense.date, groupBy);
      trends[dateKey] = (trends[dateKey] || 0) + expense.expenseAmount;
    });

    return Object.entries(trends)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, amount]) => ({
        period,
        amount: Math.round(amount * 100) / 100,
      }));
  }

  /**
   * Calculate miles trends from fuel expenses
   */
  calculateMilesTrends(fuelExpenses: Expense[], groupBy: 'day' | 'week' | 'month' | 'year') {
    const trends: { [key: string]: { miles: number; count: number } } = {};

    fuelExpenses.forEach((expense) => {
      const dateKey = this.getDateKey(expense.date, groupBy);

      if (!trends[dateKey]) {
        trends[dateKey] = { miles: 0, count: 0 };
      }

      // Estimate miles from fuelAmount and average MPG (rough calculation)
      const estimatedMiles = (expense.fuelAmount || 0) * 25; // Assume 25 MPG average
      trends[dateKey].miles += estimatedMiles;
      trends[dateKey].count += 1;
    });

    return Object.entries(trends)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({
        period,
        miles: Math.round(data.miles),
      }));
  }

  /**
   * Calculate cost per mile trends
   */
  calculateCostPerMileTrends(expenses: Expense[], groupBy: 'day' | 'week' | 'month' | 'year') {
    const costTrends = this.calculateTrends(expenses, groupBy);
    const fuelExpenses = expenses.filter((e) => e.category === 'fuel' && e.mileage);
    const milesTrends = this.calculateMilesTrends(fuelExpenses, groupBy);

    // Combine cost and miles data
    const costPerMileTrends = costTrends.map((costData) => {
      const milesData = milesTrends.find((m) => m.period === costData.period);
      const miles = milesData ? milesData.miles : 0;
      const costPerMile = miles > 0 ? costData.amount / miles : 0;

      return {
        period: costData.period,
        costPerMile: Math.round(costPerMile * 100) / 100,
      };
    });

    return costPerMileTrends;
  }

  /**
   * Calculate fuel efficiency across all vehicles
   */
  calculateFuelEfficiency(expenses: Expense[], vehicles: Vehicle[]) {
    const fuelExpenses = expenses.filter((e) => e.category === 'fuel');

    if (fuelExpenses.length === 0) {
      return {
        averageMPG: 0,
        totalVolume: 0,
        totalFuelCost: 0,
        averageCostPerGallon: 0,
      };
    }

    let totalVolume = 0;
    let totalFuelCost = 0;
    let totalMiles = 0;

    // Group by vehicle to calculate miles driven
    const vehicleData: { [key: string]: { expenses: Expense[]; initialMileage: number } } = {};

    vehicles.forEach((vehicle) => {
      vehicleData[vehicle.id] = {
        expenses: fuelExpenses.filter((e) => e.vehicleId === vehicle.id),
        initialMileage: vehicle.initialMileage || 0,
      };
    });

    Object.values(vehicleData).forEach(({ expenses: vehicleFuelExpenses, initialMileage }) => {
      if (vehicleFuelExpenses.length > 0) {
        const sortedExpenses = vehicleFuelExpenses.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const maxMileage = Math.max(...sortedExpenses.map((e) => e.mileage || 0));
        const vehicleMiles = maxMileage - initialMileage;

        totalMiles += vehicleMiles;
        totalVolume += vehicleFuelExpenses.reduce((sum, e) => sum + (e.fuelAmount || 0), 0);
        totalFuelCost += vehicleFuelExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
      }
    });

    const averageMPG = totalVolume > 0 ? totalMiles / totalVolume : 0;
    const averageCostPerGallon = totalVolume > 0 ? totalFuelCost / totalVolume : 0;

    return {
      averageMPG: Math.round(averageMPG * 100) / 100,
      totalVolume: Math.round(totalVolume * 100) / 100,
      totalFuelCost: Math.round(totalFuelCost * 100) / 100,
      averageCostPerGallon: Math.round(averageCostPerGallon * 100) / 100,
    };
  }

  /**
   * Calculate fuel efficiency for a single vehicle
   */
  calculateFuelEfficiencyForVehicle(fuelExpenses: Expense[], initialMileage: number) {
    if (fuelExpenses.length === 0) {
      return {
        averageMPG: 0,
        totalVolume: 0,
        totalMiles: 0,
        trend: [],
      };
    }

    const sortedExpenses = fuelExpenses.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let totalVolume = 0;
    let previousMileage = initialMileage;
    const trend: { date: Date; mpg: number; mileage?: number }[] = [];

    sortedExpenses.forEach((expense) => {
      if (expense.fuelAmount && expense.mileage) {
        const milesDriven = expense.mileage - previousMileage;
        const mpg = milesDriven > 0 ? milesDriven / expense.fuelAmount : 0;

        if (mpg > 0 && mpg < 100) {
          trend.push({
            date: expense.date,
            mpg: Math.round(mpg * 100) / 100,
            mileage: expense.mileage,
          });
        }

        totalVolume += expense.fuelAmount;
        previousMileage = expense.mileage;
      }
    });

    const totalMiles = previousMileage - initialMileage;
    const averageMPG = totalVolume > 0 ? totalMiles / totalVolume : 0;

    return {
      averageMPG: Math.round(averageMPG * 100) / 100,
      totalVolume: Math.round(totalVolume * 100) / 100,
      totalMiles,
      trend,
    };
  }

  /**
   * Calculate cost per mile across all vehicles
   */
  calculateCostPerMile(expenses: Expense[], vehicles: Vehicle[]) {
    let totalCost = 0;
    let totalMiles = 0;

    vehicles.forEach((vehicle) => {
      const vehicleExpenses = expenses.filter((e) => e.vehicleId === vehicle.id);
      const expensesWithMileage = vehicleExpenses.filter((e) => e.mileage && e.mileage > 0);

      if (expensesWithMileage.length > 0) {
        const maxMileage = Math.max(
          ...expensesWithMileage.map((e) => e.mileage).filter((m): m is number => m != null)
        );
        const vehicleMiles = maxMileage - (vehicle.initialMileage || 0);
        const vehicleCost = vehicleExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);

        totalMiles += vehicleMiles;
        totalCost += vehicleCost;
      }
    });

    const costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;

    return {
      totalCostPerMile: Math.round(costPerMile * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalMiles,
    };
  }

  /**
   * Calculate cost per mile for a single vehicle
   */
  calculateCostPerMileForVehicle(expenses: Expense[], initialMileage: number) {
    const expensesWithMileage = expenses.filter((e) => e.mileage && e.mileage > 0);

    if (expensesWithMileage.length === 0) {
      return {
        costPerMile: 0,
        totalCost: 0,
        totalMiles: 0,
      };
    }

    const maxMileage = Math.max(
      ...expensesWithMileage.map((e) => e.mileage).filter((m): m is number => m != null)
    );
    const totalMiles = maxMileage - initialMileage;
    const totalCost = expenses.reduce((sum, e) => sum + e.expenseAmount, 0);

    const costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;

    return {
      costPerMile: Math.round(costPerMile * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalMiles,
    };
  }

  /**
   * Helper to get date key for grouping
   */
  private getDateKey(date: Date, groupBy: 'day' | 'week' | 'month' | 'year'): string {
    const d = new Date(date);

    switch (groupBy) {
      case 'day':
        return d.toISOString().substring(0, 10); // YYYY-MM-DD
      case 'week': {
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        return weekStart.toISOString().substring(0, 10);
      }
      case 'month':
        return d.toISOString().substring(0, 7); // YYYY-MM
      case 'year':
        return d.getFullYear().toString();
      default:
        return d.toISOString().substring(0, 7);
    }
  }
}
