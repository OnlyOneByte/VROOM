/**
 * Shared Calculation Utilities
 *
 * Pure functions for common calculations used across the application.
 * These functions are extracted from analytics services to avoid duplication.
 */

import type { Expense } from '../db/schema';

// ============================================================================
// FUEL EFFICIENCY CALCULATIONS
// ============================================================================

/**
 * Calculate MPG (Miles Per Gallon) from miles driven and fuel consumed
 */
export function calculateMPG(miles: number, fuel: number): number {
  return fuel > 0 ? miles / fuel : 0;
}

/**
 * Calculate average MPG from a series of fuel expenses
 * Uses consecutive mileage readings to determine miles driven between fill-ups
 */
export function calculateAverageMPG(fuelExpenses: Expense[]): number | null {
  if (fuelExpenses.length < 2) {
    return null;
  }

  // Sort by date to ensure chronological order
  const sortedExpenses = [...fuelExpenses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const mpgValues: number[] = [];

  for (let i = 1; i < sortedExpenses.length; i++) {
    const current = sortedExpenses[i];
    const previous = sortedExpenses[i - 1];

    // Skip pairs affected by missed fill-ups
    if (current.missedFillup || previous.missedFillup) {
      continue;
    }

    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const mpg = calculateMPG(miles, current.fuelAmount);

      // Filter out unrealistic values (negative miles or extremely high/low MPG)
      if (mpg > 0 && mpg < 150) {
        mpgValues.push(mpg);
      }
    }
  }

  if (mpgValues.length === 0) {
    return null;
  }

  const sum = mpgValues.reduce((acc, mpg) => acc + mpg, 0);
  return sum / mpgValues.length;
}

// ============================================================================
// COST CALCULATIONS
// ============================================================================

/**
 * Calculate cost per mile
 */
export function calculateCostPerMile(cost: number, miles: number): number {
  return miles > 0 ? cost / miles : 0;
}

/**
 * Round currency values to 2 decimal places
 */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// ============================================================================
// DATE GROUPING
// ============================================================================

/**
 * Group a date by the specified period
 * Returns a string key that can be used for grouping
 */
export function groupByPeriod(date: Date, period: 'day' | 'week' | 'month' | 'year'): string {
  const d = new Date(date);

  switch (period) {
    case 'day':
      return d.toISOString().substring(0, 10); // YYYY-MM-DD
    case 'week': {
      // Get the start of the week (Sunday)
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      return weekStart.toISOString().substring(0, 10);
    }
    case 'month':
      return d.toISOString().substring(0, 7); // YYYY-MM
    case 'year':
      return d.getFullYear().toString();
    default:
      return d.toISOString().substring(0, 7); // Default to month
  }
}

/**
 * Calculate monthly breakdown for insurance policy
 */
export function calculateMonthlyBreakdown(policy: {
  startDate: Date;
  endDate: Date;
  monthlyCost: number;
  termLengthMonths: number;
}) {
  const startDate = new Date(policy.startDate);
  const endDate = new Date(policy.endDate);
  const breakdown: {
    month: number;
    cost: number;
    monthName: string;
    startDate?: string;
    endDate?: string;
    isPaid?: boolean;
    daysInMonth?: number;
  }[] = [];
  const currentDate = new Date(startDate);
  let monthNumber = 1;

  while (currentDate < endDate && monthNumber <= policy.termLengthMonths) {
    const monthStart = new Date(currentDate);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    if (monthEnd > endDate) {
      monthEnd.setTime(endDate.getTime());
    }

    breakdown.push({
      month: monthNumber,
      monthName: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      startDate: monthStart.toISOString().split('T')[0],
      endDate: monthEnd.toISOString().split('T')[0],
      cost: Math.round(policy.monthlyCost * 100) / 100,
      isPaid: monthEnd < new Date(),
      daysInMonth:
        Math.ceil((monthEnd.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
    });

    currentDate.setMonth(currentDate.getMonth() + 1);
    monthNumber++;
  }

  return breakdown;
}
