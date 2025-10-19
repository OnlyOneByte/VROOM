import type { ExpenseData } from './types';

export class CostCalculator {
  calculateCostPerMileForVehicle(expenses: ExpenseData[], initialMileage: number) {
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
    const totalCost = expenses.reduce((sum, e) => sum + e.amount, 0);

    const costPerMile = totalMiles > 0 ? totalCost / totalMiles : 0;

    return {
      costPerMile: Math.round(costPerMile * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalMiles,
    };
  }
}
