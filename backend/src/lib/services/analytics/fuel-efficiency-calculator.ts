import type { ExpenseData } from './types';

export class FuelEfficiencyCalculator {
  calculateForVehicle(fuelExpenses: ExpenseData[], initialMileage: number) {
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
      if (expense.volume && expense.mileage) {
        const milesDriven = expense.mileage - previousMileage;
        const mpg = milesDriven > 0 ? milesDriven / expense.volume : 0;

        if (mpg > 0 && mpg < 100) {
          trend.push({
            date: expense.date,
            mpg: Math.round(mpg * 100) / 100,
            mileage: expense.mileage,
          });
        }

        totalVolume += expense.volume;
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
}
