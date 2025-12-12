/**
 * Merged Analytics Service
 *
 * This file consolidates three analytics-related services:
 * - analytics-service.ts (high-level analytics operations)
 * - expense-calculator.ts (expense calculations and trends)
 * - loan-calculator.ts (loan amortization and payment calculations)
 *
 * All analytics functionality is now in this single file.
 * Calculation functions are imported from shared utils/calculations.ts
 */

import { DatabaseError } from '../core/errors';
import type { ExpenseRepository } from '../repositories/expense';
import type { VehicleRepository } from '../repositories/vehicle';
import type {
  AnalyticsQuery,
  DashboardAnalytics,
  Expense,
  TrendData,
  Vehicle,
  VehicleAnalytics,
} from '../types/analytics';
import {
  calculateCostPerMile,
  calculateMPG,
  groupByPeriod,
  roundCurrency,
} from '../utils/calculations';
import { logger } from '../utils/logger';

// ============================================================================
// LOAN CALCULATION TYPES
// ============================================================================

export interface LoanTerms {
  principal: number;
  apr: number;
  termMonths: number;
  startDate: Date;
}

export interface PaymentScheduleItem {
  paymentNumber: number;
  paymentDate: Date;
  paymentAmount: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
}

export interface LoanAnalysis {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: Date;
  schedule: PaymentScheduleItem[];
}

// ============================================================================
// ANALYTICS SERVICE CLASS
// ============================================================================

export class AnalyticsService {
  constructor(
    private expenseRepo: ExpenseRepository,
    private vehicleRepo: VehicleRepository
  ) {}

  // ============================================================================
  // HIGH-LEVEL ANALYTICS OPERATIONS
  // ============================================================================

  async getDashboardAnalytics(userId: string, query: AnalyticsQuery): Promise<DashboardAnalytics> {
    try {
      logger.debug('Fetching dashboard analytics', { userId, query });

      const vehicles = await this.vehicleRepo.findByUserId(userId);

      if (vehicles.length === 0) {
        logger.info('No vehicles found for user', { userId });
        return this.getEmptyDashboard();
      }

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
        totalExpenses: this.calculateTotal(expenses),
        monthlyExpensesTrends: this.calculateTrends(expenses, query.groupBy),
        categoryBreakdown: this.calculateBreakdown(expenses),
        fuelEfficiency: this.calculateFuelEfficiency(expenses, vehicles),
        costPerMile: this.calculateCostPerMileAcrossVehicles(expenses, vehicles),
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

      const expenses: Expense[] = await this.expenseRepo.find({
        vehicleId,
        startDate: query.startDate,
        endDate: query.endDate,
      });

      const totalExpenses = this.calculateTotal(expenses);
      const monthlyTrends = this.calculateTrends(expenses, query.groupBy);
      const categoryBreakdown = this.calculateBreakdown(expenses);

      const fuelExpenses = expenses.filter((e) => e.category === 'fuel');
      const fuelEfficiency = this.calculateFuelEfficiencyForVehicle(
        fuelExpenses,
        vehicle.initialMileage || 0
      );

      const costPerMile = this.calculateCostPerMileForVehicle(
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

      const vehicles = await this.vehicleRepo.findByUserId(userId);

      const expenses: Expense[] = await this.expenseRepo.find({
        userId,
        startDate: query.startDate,
        endDate: query.endDate,
      });

      const costTrends = this.calculateTrends(expenses, query.groupBy);
      const fuelExpenses = expenses.filter((e) => e.category === 'fuel' && e.mileage);
      const milesTrends = this.calculateMilesTrends(fuelExpenses, query.groupBy);
      const costPerMileTrends = this.calculateCostPerMileTrends(expenses, query.groupBy);

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

  // ============================================================================
  // EXPENSE CALCULATIONS (from expense-calculator.ts)
  // ============================================================================

  /**
   * Calculate total expenses
   */
  calculateTotal(expenses: Expense[]): number {
    const total = expenses.reduce((sum, expense) => sum + expense.expenseAmount, 0);
    return roundCurrency(total);
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
      breakdown[category].amount = roundCurrency(breakdown[category].amount);
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
      const dateKey = groupByPeriod(expense.date, groupBy);
      trends[dateKey] = (trends[dateKey] || 0) + expense.expenseAmount;
    });

    return Object.entries(trends)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, amount]) => ({
        period,
        amount: roundCurrency(amount),
      }));
  }

  /**
   * Calculate miles trends from fuel expenses
   */
  calculateMilesTrends(fuelExpenses: Expense[], groupBy: 'day' | 'week' | 'month' | 'year') {
    const trends: { [key: string]: { miles: number; count: number } } = {};

    fuelExpenses.forEach((expense) => {
      const dateKey = groupByPeriod(expense.date, groupBy);

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
      const costPerMileValue = calculateCostPerMile(costData.amount, miles);

      return {
        period: costData.period,
        costPerMile: roundCurrency(costPerMileValue),
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

    const averageMPG = calculateMPG(totalMiles, totalVolume);
    const averageCostPerGallon = totalVolume > 0 ? totalFuelCost / totalVolume : 0;

    return {
      averageMPG: roundCurrency(averageMPG),
      totalVolume: roundCurrency(totalVolume),
      totalFuelCost: roundCurrency(totalFuelCost),
      averageCostPerGallon: roundCurrency(averageCostPerGallon),
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
        const mpg = calculateMPG(milesDriven, expense.fuelAmount);

        if (mpg > 0 && mpg < 100) {
          trend.push({
            date: expense.date,
            mpg: roundCurrency(mpg),
            mileage: expense.mileage,
          });
        }

        totalVolume += expense.fuelAmount;
        previousMileage = expense.mileage;
      }
    });

    const totalMiles = previousMileage - initialMileage;
    const averageMPG = calculateMPG(totalMiles, totalVolume);

    return {
      averageMPG: roundCurrency(averageMPG),
      totalVolume: roundCurrency(totalVolume),
      totalMiles,
      trend,
    };
  }

  /**
   * Calculate cost per mile across all vehicles
   */
  calculateCostPerMileAcrossVehicles(expenses: Expense[], vehicles: Vehicle[]) {
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

    const costPerMileValue = calculateCostPerMile(totalCost, totalMiles);

    return {
      totalCostPerMile: roundCurrency(costPerMileValue),
      totalCost: roundCurrency(totalCost),
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

    const costPerMileValue = calculateCostPerMile(totalCost, totalMiles);

    return {
      costPerMile: roundCurrency(costPerMileValue),
      totalCost: roundCurrency(totalCost),
      totalMiles,
    };
  }

  // ============================================================================
  // LOAN CALCULATIONS (from loan-calculator.ts)
  // ============================================================================

  /**
   * Calculate monthly payment using standard amortization formula
   */
  calculateMonthlyPayment(principal: number, apr: number, termMonths: number): number {
    if (apr === 0) {
      return principal / termMonths;
    }

    const monthlyRate = apr / 100 / 12;
    const numerator = principal * monthlyRate * (1 + monthlyRate) ** termMonths;
    const denominator = (1 + monthlyRate) ** termMonths - 1;

    return numerator / denominator;
  }

  /**
   * Generate complete amortization schedule
   */
  generateAmortizationSchedule(terms: LoanTerms): LoanAnalysis {
    const { principal, apr, termMonths, startDate } = terms;
    const monthlyPayment = this.calculateMonthlyPayment(principal, apr, termMonths);
    const monthlyRate = apr / 100 / 12;

    const schedule: PaymentScheduleItem[] = [];
    let remainingBalance = principal;
    let totalInterest = 0;

    for (let paymentNumber = 1; paymentNumber <= termMonths; paymentNumber++) {
      const interestAmount = remainingBalance * monthlyRate;
      const principalAmount = monthlyPayment - interestAmount;

      // Ensure we don't overpay on the last payment
      const actualPrincipalAmount = Math.min(principalAmount, remainingBalance);
      const actualPaymentAmount = interestAmount + actualPrincipalAmount;

      remainingBalance -= actualPrincipalAmount;
      totalInterest += interestAmount;

      // Calculate payment date (add months to start date)
      const paymentDate = new Date(startDate);
      paymentDate.setMonth(paymentDate.getMonth() + paymentNumber);

      schedule.push({
        paymentNumber,
        paymentDate,
        paymentAmount: actualPaymentAmount,
        principalAmount: actualPrincipalAmount,
        interestAmount,
        remainingBalance: Math.max(0, remainingBalance),
      });

      // Break if loan is paid off
      if (remainingBalance <= 0.01) {
        break;
      }
    }

    const payoffDate = schedule[schedule.length - 1]?.paymentDate || startDate;

    return {
      monthlyPayment,
      totalInterest,
      totalPayments: schedule.length,
      payoffDate,
      schedule,
    };
  }

  /**
   * Calculate remaining balance after a specific number of payments
   */
  calculateRemainingBalance(
    principal: number,
    apr: number,
    termMonths: number,
    paymentsMade: number
  ): number {
    if (paymentsMade >= termMonths) {
      return 0;
    }

    if (apr === 0) {
      const monthlyPayment = principal / termMonths;
      return principal - monthlyPayment * paymentsMade;
    }

    const monthlyRate = apr / 100 / 12;
    const monthlyPayment = this.calculateMonthlyPayment(principal, apr, termMonths);

    let balance = principal;
    for (let i = 0; i < paymentsMade; i++) {
      const interestPayment = balance * monthlyRate;
      const principalPayment = monthlyPayment - interestPayment;
      balance -= principalPayment;
    }

    return Math.max(0, balance);
  }

  /**
   * Calculate payment breakdown for a specific payment number
   */
  calculatePaymentBreakdown(
    principal: number,
    apr: number,
    termMonths: number,
    paymentNumber: number
  ): { principalAmount: number; interestAmount: number; remainingBalance: number } {
    const monthlyRate = apr / 100 / 12;
    const monthlyPayment = this.calculateMonthlyPayment(principal, apr, termMonths);

    // Calculate balance before this payment
    const balanceBeforePayment = this.calculateRemainingBalance(
      principal,
      apr,
      termMonths,
      paymentNumber - 1
    );

    const interestAmount = balanceBeforePayment * monthlyRate;
    const principalAmount = Math.min(monthlyPayment - interestAmount, balanceBeforePayment);
    const remainingBalance = Math.max(0, balanceBeforePayment - principalAmount);

    return {
      principalAmount,
      interestAmount,
      remainingBalance,
    };
  }

  /**
   * Calculate the impact of extra payments
   */
  calculateExtraPaymentImpact(
    terms: LoanTerms,
    extraPaymentAmount: number,
    extraPaymentFrequency: 'monthly' | 'yearly' | 'one-time' = 'monthly'
  ): {
    originalAnalysis: LoanAnalysis;
    newAnalysis: LoanAnalysis;
    interestSavings: number;
    timeSavings: number;
  } {
    const originalAnalysis = this.generateAmortizationSchedule(terms);

    // Simplified calculation - reduce effective principal
    let adjustedPrincipal = terms.principal;

    if (extraPaymentFrequency === 'monthly') {
      const effectiveExtraPayment = extraPaymentAmount * 0.8;
      adjustedPrincipal = Math.max(0, terms.principal - effectiveExtraPayment);
    }

    const newTerms: LoanTerms = {
      ...terms,
      principal: adjustedPrincipal,
    };

    const newAnalysis = this.generateAmortizationSchedule(newTerms);

    return {
      originalAnalysis,
      newAnalysis,
      interestSavings: originalAnalysis.totalInterest - newAnalysis.totalInterest,
      timeSavings: originalAnalysis.totalPayments - newAnalysis.totalPayments,
    };
  }

  /**
   * Validate loan terms
   */
  validateLoanTerms(terms: Partial<LoanTerms>): string[] {
    const errors: string[] = [];

    if (!terms.principal || terms.principal <= 0) {
      errors.push('Principal amount must be greater than 0');
    }

    if (terms.apr === undefined || terms.apr < 0 || terms.apr > 50) {
      errors.push('APR must be between 0 and 50');
    }

    if (!terms.termMonths || terms.termMonths <= 0 || terms.termMonths > 600) {
      errors.push('Term must be between 1 and 600 months');
    }

    if (!terms.startDate) {
      errors.push('Start date is required');
    }

    return errors;
  }
}

// ============================================================================
// STANDALONE LOAN CALCULATION FUNCTIONS (for backward compatibility)
// ============================================================================

/**
 * Calculate monthly payment using standard amortization formula
 */
export function calculateMonthlyPayment(
  principal: number,
  apr: number,
  termMonths: number
): number {
  if (apr === 0) {
    return principal / termMonths;
  }

  const monthlyRate = apr / 100 / 12;
  const numerator = principal * monthlyRate * (1 + monthlyRate) ** termMonths;
  const denominator = (1 + monthlyRate) ** termMonths - 1;

  return numerator / denominator;
}

/**
 * Generate complete amortization schedule
 */
export function generateAmortizationSchedule(terms: LoanTerms): LoanAnalysis {
  const { principal, apr, termMonths, startDate } = terms;
  const monthlyPayment = calculateMonthlyPayment(principal, apr, termMonths);
  const monthlyRate = apr / 100 / 12;

  const schedule: PaymentScheduleItem[] = [];
  let remainingBalance = principal;
  let totalInterest = 0;

  for (let paymentNumber = 1; paymentNumber <= termMonths; paymentNumber++) {
    const interestAmount = remainingBalance * monthlyRate;
    const principalAmount = monthlyPayment - interestAmount;

    const actualPrincipalAmount = Math.min(principalAmount, remainingBalance);
    const actualPaymentAmount = interestAmount + actualPrincipalAmount;

    remainingBalance -= actualPrincipalAmount;
    totalInterest += interestAmount;

    const paymentDate = new Date(startDate);
    paymentDate.setMonth(paymentDate.getMonth() + paymentNumber);

    schedule.push({
      paymentNumber,
      paymentDate,
      paymentAmount: actualPaymentAmount,
      principalAmount: actualPrincipalAmount,
      interestAmount,
      remainingBalance: Math.max(0, remainingBalance),
    });

    if (remainingBalance <= 0.01) {
      break;
    }
  }

  const payoffDate = schedule[schedule.length - 1]?.paymentDate || startDate;

  return {
    monthlyPayment,
    totalInterest,
    totalPayments: schedule.length,
    payoffDate,
    schedule,
  };
}

/**
 * Calculate payment breakdown for a specific payment number
 */
export function calculatePaymentBreakdown(
  principal: number,
  apr: number,
  termMonths: number,
  paymentNumber: number
): { principalAmount: number; interestAmount: number; remainingBalance: number } {
  const monthlyRate = apr / 100 / 12;
  const monthlyPayment = calculateMonthlyPayment(principal, apr, termMonths);

  // Calculate balance before this payment
  let balance = principal;
  for (let i = 0; i < paymentNumber - 1; i++) {
    const interestPayment = balance * monthlyRate;
    const principalPayment = monthlyPayment - interestPayment;
    balance -= principalPayment;
  }

  const interestAmount = balance * monthlyRate;
  const principalAmount = Math.min(monthlyPayment - interestAmount, balance);
  const remainingBalance = Math.max(0, balance - principalAmount);

  return {
    principalAmount,
    interestAmount,
    remainingBalance,
  };
}

/**
 * Validate loan terms
 */
export function validateLoanTerms(terms: Partial<LoanTerms>): string[] {
  const errors: string[] = [];

  if (!terms.principal || terms.principal <= 0) {
    errors.push('Principal amount must be greater than 0');
  }

  if (terms.apr === undefined || terms.apr < 0 || terms.apr > 50) {
    errors.push('APR must be between 0 and 50');
  }

  if (!terms.termMonths || terms.termMonths <= 0 || terms.termMonths > 600) {
    errors.push('Term must be between 1 and 600 months');
  }

  if (!terms.startDate) {
    errors.push('Start date is required');
  }

  return errors;
}
