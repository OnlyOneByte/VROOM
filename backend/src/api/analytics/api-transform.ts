import { EXPENSE_CATEGORIES } from '../../db/types';
import { toMajor } from '../../utils/money';
import type { AnalyticsQueryResult, BucketItems, QueryPeriod } from './query-repository';
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

export function quickStatsToApi(d: QuickStatsData, scale: number): QuickStatsData {
  const { major: c, majorOrNull: cn } = toMajor(scale);
  return { ...d, ytdSpending: c(d.ytdSpending), costPerDistance: cn(d.costPerDistance) };
}

export function fuelStatsToApi(d: FuelStatsData, scale: number): FuelStatsData {
  const { major: c, majorOrNull: cn } = toMajor(scale);
  return {
    ...d,
    averageCost: {
      perFillup: cn(d.averageCost.perFillup),
      bestCostPerDistance: cn(d.averageCost.bestCostPerDistance),
      worstCostPerDistance: cn(d.averageCost.worstCostPerDistance),
      avgCostPerDay: cn(d.averageCost.avgCostPerDay),
      costPerDistance: cn(d.averageCost.costPerDistance),
    },
    monthlySpend: d.monthlySpend && {
      months: d.monthlySpend.months,
      fuel: cn(d.monthlySpend.fuel),
      charging: cn(d.monthlySpend.charging),
    },
    previous: {
      ...d.previous,
      costPerDistance: cn(d.previous.costPerDistance),
      monthlySpend: d.previous.monthlySpend && {
        months: d.previous.monthlySpend.months,
        fuel: cn(d.previous.monthlySpend.fuel),
        charging: cn(d.previous.monthlySpend.charging),
      },
    },
    gasPriceHistory: d.gasPriceHistory.map((g) => ({ ...g, pricePerVolume: c(g.pricePerVolume) })),
    fillupsByVehicle: d.fillupsByVehicle.map((v) => ({ ...v, cost: c(v.cost) })),
    chargingByVehicle: d.chargingByVehicle.map((v) => ({ ...v, cost: c(v.cost) })),
    fillupCostByVehicle: d.fillupCostByVehicle.map((f) => ({ ...f, avgCost: c(f.avgCost) })),
    costPerDistance: d.costPerDistance.map((r) => ({
      ...r,
      costPerDistance: c(r.costPerDistance),
    })),
    charging: {
      ...d.charging,
      averageCost: {
        perSession: cn(d.charging.averageCost.perSession),
        perEnergyUnit: cn(d.charging.averageCost.perEnergyUnit),
      },
      priceHistory: d.charging.priceHistory.map((g) => ({
        ...g,
        pricePerVolume: c(g.pricePerVolume),
      })),
    },
  };
}

export function fuelAdvancedToApi(d: FuelAdvancedData, scale: number): FuelAdvancedData {
  const { major: c } = toMajor(scale);
  return {
    ...d,
    // Do not convert vehicleRadar: its cost-named fields hold 0-100 scores, not money.
    dayOfWeekPatterns: d.dayOfWeekPatterns.map((p) => ({ ...p, avgCost: c(p.avgCost) })),
    monthlyCostHeatmap: d.monthlyCostHeatmap.map((m) => {
      const dollars = { ...m };
      for (const category of EXPENSE_CATEGORIES) dollars[category] = c(m[category]);
      return dollars;
    }),
  };
}

export function crossVehicleToApi(d: CrossVehicleData, scale: number): CrossVehicleData {
  const { major: c, majorOrNull: cn } = toMajor(scale);
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

export function financingToApi(d: FinancingData, scale: number): FinancingData {
  const { major: c } = toMajor(scale);
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

export function insuranceToApi(d: InsuranceData, scale: number): InsuranceData {
  const { major: c, majorOrNull: cn } = toMajor(scale);
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

export function vehicleTcoToApi(d: VehicleTCOData, scale: number): VehicleTCOData {
  const { major: c, majorOrNull: cn } = toMajor(scale);
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
  };
}

export function vehicleExpensesToApi(d: VehicleExpensesData, scale: number): VehicleExpensesData {
  const { major: c } = toMajor(scale);
  return {
    maintenanceCosts: d.maintenanceCosts.map((m) => ({ ...m, cost: c(m.cost) })),
    fuelEfficiencyAndCost: d.fuelEfficiencyAndCost.map((f) => ({ ...f, cost: c(f.cost) })),
    expenseBreakdown: d.expenseBreakdown.map((e) => ({ ...e, amount: c(e.amount) })),
  };
}

export function yearEndToApi(d: YearEndData, scale: number): YearEndData {
  const { major: c, majorOrNull: cn } = toMajor(scale);
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

export function analyticsSummaryToApi(
  d: AnalyticsSummaryData,
  scale: number
): AnalyticsSummaryData {
  return {
    quickStats: quickStatsToApi(d.quickStats, scale),
    fuelStats: fuelStatsToApi(d.fuelStats, scale),
    fuelAdvanced: fuelAdvancedToApi(d.fuelAdvanced, scale),
  };
}

function queryPeriodToApi(d: QueryPeriod, money: boolean, scale: number): QueryPeriod {
  const { majorOrNull: cn } = toMajor(scale);
  const value = money ? cn : (v: number | null) => v;
  return {
    ...d,
    series: d.series.map((s) => ({ ...s, values: s.values.map(value) })),
    totals: {
      ...d.totals,
      value: value(d.totals.value),
      perBucket: value(d.totals.perBucket),
      perDistance: cn(d.totals.perDistance),
    },
  };
}

export function analyticsQueryToApi(d: AnalyticsQueryResult, scale: number): AnalyticsQueryResult {
  const { major: c } = toMajor(scale);
  const money = d.metric === 'cost' || d.metric === 'costPerDistance';
  return {
    ...d,
    ...queryPeriodToApi(d, money, scale),
    compare: d.compare ? queryPeriodToApi(d.compare, money, scale) : null,
    ...(d.annotations && {
      annotations: d.annotations.map((a) => ({ ...a, amount: c(a.amount) })),
    }),
  };
}

export function bucketItemsToApi(d: BucketItems, scale: number): BucketItems {
  const { major: c } = toMajor(scale);
  const part = (p: { total: number; count: number } | null) =>
    p ? { total: c(p.total), count: p.count } : null;
  return {
    total: c(d.total),
    count: d.count,
    fuel: part(d.fuel),
    items: d.items.map((i) => ({ ...i, amount: c(i.amount) })),
    others: part(d.others),
    categories: d.categories,
  };
}
