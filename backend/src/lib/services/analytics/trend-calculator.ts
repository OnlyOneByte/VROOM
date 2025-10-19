import type { ExpenseData } from './types';

export class TrendCalculator {
  calculate(expenses: ExpenseData[], groupBy: string) {
    const trends: { [key: string]: number } = {};

    expenses.forEach((expense) => {
      const dateKey = this.getDateKey(expense.date, groupBy);
      trends[dateKey] = (trends[dateKey] || 0) + expense.amount;
    });

    return Object.entries(trends)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, amount]) => ({
        period,
        amount: Math.round(amount * 100) / 100,
      }));
  }

  calculateMilesTrends(fuelExpenses: ExpenseData[], groupBy: string) {
    const trends: { [key: string]: { miles: number; count: number } } = {};

    fuelExpenses.forEach((expense) => {
      const dateKey = this.getDateKey(expense.date, groupBy);

      if (!trends[dateKey]) {
        trends[dateKey] = { miles: 0, count: 0 };
      }

      // Estimate miles from volume and average MPG (rough calculation)
      const estimatedMiles = (expense.volume || 0) * 25; // Assume 25 MPG average
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

  calculateCostPerMileTrends(expenses: ExpenseData[], groupBy: string) {
    const costTrends = this.calculate(expenses, groupBy);
    const fuelExpenses = expenses.filter((e) => e.type === 'fuel' && e.mileage);
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

  private getDateKey(date: Date, groupBy: string): string {
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
