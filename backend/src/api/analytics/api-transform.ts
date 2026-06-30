/**
 * Analytics display edge (money-cents-migration T6) — convert every MONEY field in an analytics response
 * from integer CENTS → dollars, so the frontend's existing dollar contract is unchanged. Analytics money
 * is computed in CENTS throughout repository.ts + utils/analytics-charts.ts (sums/reduces of expenseAmount,
 * financing/insurance amounts — all cents); this is the ONE boundary that converts back to dollars.
 *
 * Each converter mirrors EXACTLY one response interface in repository.ts. A field is converted iff it is a
 * stored-money amount OR a cents-denominated ratio (costPer*, pricePerVolume — the numerator is cents, so
 * /100 yields dollars-per-unit). Counts, distances, percentages, efficiency (mi/gal, mi/kWh), scores,
 * apr, and date/label strings are NOT money — left untouched. Keep these in lockstep with the interfaces
 * (the money-field set is the design §1 surface flowing through analytics).
 */

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

/** cents→dollars, NULL-safe (an absent optional money value stays null). */
const cn = (v: number | null): number | null => (v == null ? v : c(v));

export function quickStatsToApi(d: QuickStatsData): QuickStatsData {
  return { ...d, ytdSpending: c(d.ytdSpending) };
}

export function fuelStatsToApi(d: FuelStatsData): FuelStatsData {
  return {
    ...d,
    // fillups / volume / fuelConsumption / fillupDetails / distance / monthlyConsumption /
    // odometerProgression are NOT money (counts, gallons, mi/gal, mileage) — untouched.
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
    // maintenanceTimeline / seasonalEfficiency / fillupIntervals are NOT money.
    // vehicleRadar is NOT money: its `maintenanceCost` + `annualCost` fields are normalizeScore() 0-100
    // RADAR SCORES (analytics-charts.ts buildVehicleRadar — every field is normalized to [0,100] for the
    // radar chart), despite the cost-y names. Converting them /100 would corrupt the chart (a score of 80
    // → 0.8). Leave the whole object untouched. (Verified firsthand C17.5 against buildVehicleRadar.)
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
    expenseByCategory: d.expenseByCategory.map((e) => ({ ...e, amount: c(e.amount) })), // percentage NOT money
    vehicleCostComparison: d.vehicleCostComparison.map((v) => ({
      ...v,
      totalCost: c(v.totalCost),
      costPerDistance: cn(v.costPerDistance),
    })),
    // fuelEfficiencyComparison is efficiency (mi/gal) — NOT money.
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
      // apr is a percent — NOT money.
    })),
    monthlyTimeline: d.monthlyTimeline.map((t) => ({
      ...t,
      vehicles: t.vehicles.map((v) => ({ ...v, amount: c(v.amount) })),
    })),
    typeDistribution: d.typeDistribution.map((t) => ({ ...t, value: c(t.value) })), // value = Σ monthlyPayment
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
    fuelEfficiencyAndCost: d.fuelEfficiencyAndCost.map((f) => ({ ...f, cost: c(f.cost) })), // efficiency NOT money
    expenseBreakdown: d.expenseBreakdown.map((e) => ({ ...e, amount: c(e.amount) })),
  };
}

export function yearEndToApi(d: YearEndData): YearEndData {
  return {
    ...d,
    totalSpent: c(d.totalSpent),
    categoryBreakdown: d.categoryBreakdown.map((e) => ({ ...e, amount: c(e.amount) })), // percentage NOT money
    biggestExpense: d.biggestExpense
      ? { ...d.biggestExpense, amount: c(d.biggestExpense.amount) }
      : null,
    previousYearComparison: d.previousYearComparison
      ? { ...d.previousYearComparison, totalSpent: c(d.previousYearComparison.totalSpent) } // percentageChange NOT money
      : null,
    costPerDistance: cn(d.costPerDistance),
    // efficiencyTrend / avgEfficiency / totalDistance / vehicleCount NOT money.
  };
}

/** The /summary route returns { quickStats, fuelStats, fuelAdvanced } — convert each sub-object. */
export function analyticsSummaryToApi(d: AnalyticsSummaryData): AnalyticsSummaryData {
  return {
    quickStats: quickStatsToApi(d.quickStats),
    fuelStats: fuelStatsToApi(d.fuelStats),
    fuelAdvanced: fuelAdvancedToApi(d.fuelAdvanced),
  };
}
