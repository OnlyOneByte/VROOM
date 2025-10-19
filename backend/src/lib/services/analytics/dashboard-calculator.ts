import type { ExpenseData, VehicleData } from './types';

export class DashboardCalculator {
  calculateTotal(expenses: ExpenseData[]): number {
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    return Math.round(total * 100) / 100;
  }

  calculateBreakdown(expenses: ExpenseData[]) {
    const breakdown: { [key: string]: { amount: number; count: number; percentage: number } } = {};
    const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    expenses.forEach((expense) => {
      if (!breakdown[expense.category]) {
        breakdown[expense.category] = { amount: 0, count: 0, percentage: 0 };
      }
      breakdown[expense.category].amount += expense.amount;
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

  calculateFuelEfficiency(expenses: ExpenseData[], vehicles: VehicleData[]) {
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
    const vehicleData: { [key: string]: { expenses: ExpenseData[]; initialMileage: number } } = {};

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
        totalVolume += vehicleFuelExpenses.reduce((sum, e) => sum + (e.volume || 0), 0);
        totalFuelCost += vehicleFuelExpenses.reduce((sum, e) => sum + e.amount, 0);
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

  calculateCostPerMile(expenses: ExpenseData[], vehicles: VehicleData[]) {
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
        const vehicleCost = vehicleExpenses.reduce((sum, e) => sum + e.amount, 0);

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
}
