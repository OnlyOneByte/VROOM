/** Converts analytics money from cents to dollars at the API boundary. */

import { centsToDollars as c } from '../../utils/money';
import type {
  AnalyticsSummaryData,
  CrossVehicleData,
  FinancingData,
  FuelAdvancedData,
  FuelStatsData,
  InsuranceData,
  QuickStatsData,
  VehicleExpensesData,
  VehicleTCOData,
  YearEndData,
} from './repository';

const cn = (v: number | null): number | null => (v == null ? v : c(v));

export function quickStatsToApi(d: QuickStatsData): QuickStatsData {
  return { ...d, ytdSpending: c(d.ytdSpending) };
}

export function fuelStatsToApi(d: FuelStatsData): FuelStatsData {
  return {
    ...d,
    averageCost: {
      perFillup: cn(d.averageCost.perFillup),
      bestCostPerDistance: cn(d.averageCost.bestCostPerDistance),
      worstCostPerDistance: cn(d.averageCost.worstCostPerDistance),
      avgCostPerDay: cn(d.averageCost.avgCostPerDay),
    },
    gasPriceHistory: d.gasPriceHistory.map((g) => ({ ...g, pricePerVolume: c(g.pricePerVolume) })),
    fillupCostByVehicle: d.fillupCostByVehicle.map((f) => ({ ...f, avgCost: c(f.avgCost) })),
    costPerDistance: d.costPerDistance.map((r) => ({
      ...r,
      costPerDistance: c(r.costPerDistance),
    })),
  };
}

export function fuelAdvancedToApi(d: FuelAdvancedData): FuelAdvancedData {
  return {
    ...d,
    // vehicleRadar is left untouched: its cost-named fields hold 0-100 radar scores, not money.
    dayOfWeekPatterns: d.dayOfWeekPatterns.map((p) => ({ ...p, avgCost: c(p.avgCost) })),
    monthlyCostHeatmap: d.monthlyCostHeatmap.map((m) => ({
      ...m,
      fuel: c(m.fuel),
      maintenance: c(m.maintenance),
      financial: c(m.financial),
      regulatory: c(m.regulatory),
      enhancement: c(m.enhancement),
      misc: c(m.misc),
    })),
  };
}

export function crossVehicleToApi(d: CrossVehicleData): CrossVehicleData {
  return {
    ...d,
    monthlyExpenseTrends: d.monthlyExpenseTrends.map((t) => ({ ...t, amount: c(t.amount) })),
    expenseByCategory: d.expenseByCategory.map((e) => ({ ...e, amount: c(e.amount) })),
    vehicleCostComparison: d.vehicleCostComparison.map((v) => ({
      ...v,
      totalCost: c(v.totalCost),
      costPerDistance: cn(v.costPerDistance),
    })),
  };
}

export function financingToApi(d: FinancingData): FinancingData {
  return {
    summary: {
      ...d.summary,
      totalMonthlyPayments: c(d.summary.totalMonthlyPayments),
      remainingBalance: c(d.summary.remainingBalance),
      monthlyInterestEstimate: c(d.summary.monthlyInterestEstimate),
    },
    vehicleDetails: d.vehicleDetails.map((v) => ({
      ...v,
      monthlyPayment: c(v.monthlyPayment),
      remainingBalance: c(v.remainingBalance),
      monthlyInterestEstimate: c(v.monthlyInterestEstimate),
    })),
    monthlyTimeline: d.monthlyTimeline.map((t) => ({
      ...t,
      vehicles: t.vehicles.map((v) => ({ ...v, amount: c(v.amount) })),
    })),
    typeDistribution: d.typeDistribution.map((t) => ({ ...t, value: c(t.value) })),
    loanBreakdown: d.loanBreakdown.map((l) => ({
      ...l,
      interest: c(l.interest),
      principal: c(l.principal),
    })),
  };
}

export function insuranceToApi(d: InsuranceData): InsuranceData {
  return {
    summary: {
      ...d.summary,
      totalMonthlyPremiums: c(d.summary.totalMonthlyPremiums),
      totalAnnualPremiums: c(d.summary.totalAnnualPremiums),
    },
    vehicleDetails: d.vehicleDetails.map((v) => ({
      ...v,
      monthlyPremium: c(v.monthlyPremium),
      annualPremium: c(v.annualPremium),
      deductible: cn(v.deductible),
    })),
    monthlyPremiumTrend: d.monthlyPremiumTrend.map((t) => ({ ...t, premiums: c(t.premiums) })),
    costByCarrier: d.costByCarrier.map((cb) => ({ ...cb, annualPremium: c(cb.annualPremium) })),
  };
}

export function vehicleTcoToApi(d: VehicleTCOData): VehicleTCOData {
  return {
    ...d,
    purchasePrice: cn(d.purchasePrice),
    financingInterest: c(d.financingInterest),
    insuranceCost: c(d.insuranceCost),
    fuelCost: c(d.fuelCost),
    maintenanceCost: c(d.maintenanceCost),
    otherCosts: c(d.otherCosts),
    totalCost: c(d.totalCost),
    costPerDistance: cn(d.costPerDistance),
    costPerMonth: c(d.costPerMonth),
    monthlyTrend: d.monthlyTrend.map((m) => ({
      ...m,
      financing: c(m.financing),
      insurance: c(m.insurance),
      fuel: c(m.fuel),
      maintenance: c(m.maintenance),
    })),
  };
}

export function vehicleExpensesToApi(d: VehicleExpensesData): VehicleExpensesData {
  return {
    maintenanceCosts: d.maintenanceCosts.map((m) => ({ ...m, cost: c(m.cost) })),
    fuelEfficiencyAndCost: d.fuelEfficiencyAndCost.map((f) => ({ ...f, cost: c(f.cost) })),
    expenseBreakdown: d.expenseBreakdown.map((e) => ({ ...e, amount: c(e.amount) })),
  };
}

export function yearEndToApi(d: YearEndData): YearEndData {
  return {
    ...d,
    totalSpent: c(d.totalSpent),
    categoryBreakdown: d.categoryBreakdown.map((e) => ({ ...e, amount: c(e.amount) })),
    biggestExpense: d.biggestExpense
      ? { ...d.biggestExpense, amount: c(d.biggestExpense.amount) }
      : null,
    previousYearComparison: d.previousYearComparison
      ? { ...d.previousYearComparison, totalSpent: c(d.previousYearComparison.totalSpent) }
      : null,
    costPerDistance: cn(d.costPerDistance),
  };
}

export function analyticsSummaryToApi(d: AnalyticsSummaryData): AnalyticsSummaryData {
  return {
    quickStats: quickStatsToApi(d.quickStats),
    fuelStats: fuelStatsToApi(d.fuelStats),
    fuelAdvanced: fuelAdvancedToApi(d.fuelAdvanced),
  };
}
