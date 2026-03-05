import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { getDb } from '../../db/connection';
import {
  expenses,
  insurancePolicies,
  insurancePolicyVehicles,
  type PolicyTerm,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { DatabaseError } from '../../errors';
import {
  buildCostPerMileChart,
  buildDayOfWeekPatterns,
  buildExpenseByCategory,
  buildFillupCostByVehicle,
  buildFillupIntervals,
  buildFuelEfficiencyAndCost,
  buildFuelEfficiencyComparison,
  buildGasPriceHistory,
  buildMaintenanceTimeline,
  buildMonthlyConsumption,
  buildMonthlyCostHeatmap,
  buildMonthlyExpenseTrends,
  buildMpgTrend,
  buildSeasonalEfficiency,
  buildTCOMonthlyTrend,
  buildVehicleExpenseBreakdown,
  buildVehicleMaintenanceCosts,
  buildVehicleRadar,
  computeAverageCosts,
  computeEfficiencyPoint,
  computeFuelConsumptionMetrics,
  computeMileageScore,
  computeMpgAndCostPerMile,
  computePreviousYearComparison,
  computeRegularityScore,
  type FuelEfficiencyPoint,
  type FuelExpenseRow,
  type FuelRow,
  findBiggestExpense,
  type GeneralExpenseRow,
  toMonthKey,
} from '../../utils/analytics-charts';
import { logger } from '../../utils/logger';

export type { FuelEfficiencyPoint } from '../../utils/analytics-charts';

// ---------------------------------------------------------------------------
// Data interfaces for each analytics endpoint
// ---------------------------------------------------------------------------

export interface QuickStatsData {
  vehicleCount: number;
  ytdSpending: number;
  avgMpg: number | null;
  fleetHealthScore: number;
}

export interface FuelStatsData {
  fillups: {
    currentYear: number;
    previousYear: number;
    currentMonth: number;
    previousMonth: number;
  };
  gallons: {
    currentYear: number;
    previousYear: number;
    currentMonth: number;
    previousMonth: number;
  };
  fuelConsumption: {
    avgMpg: number | null;
    bestMpg: number | null;
    worstMpg: number | null;
  };
  fillupDetails: {
    avgVolume: number | null;
    minVolume: number | null;
    maxVolume: number | null;
  };
  averageCost: {
    perFillup: number | null;
    bestCostPerMile: number | null;
    worstCostPerMile: number | null;
    avgCostPerDay: number | null;
  };
  distance: {
    totalMiles: number;
    avgPerDay: number | null;
    avgPerMonth: number | null;
  };
  monthlyConsumption: Array<{ month: string; mpg: number; gallons: number }>;
  gasPriceHistory: Array<{ date: string; fuelType: string; pricePerGallon: number }>;
  fillupCostByVehicle: Array<{
    month: string;
    vehicleId: string;
    vehicleName: string;
    avgCost: number;
  }>;
  odometerProgression: Array<{
    month: string;
    vehicleId: string;
    vehicleName: string;
    mileage: number;
  }>;
  costPerMile: Array<{
    month: string;
    vehicleId: string;
    vehicleName: string;
    costPerMile: number;
  }>;
}

export interface FuelAdvancedData {
  maintenanceTimeline: Array<{
    service: string;
    lastServiceDate: string;
    nextDueDate: string;
    daysRemaining: number;
    status: 'good' | 'warning' | 'overdue';
  }>;
  seasonalEfficiency: Array<{ season: string; avgMpg: number; fillupCount: number }>;
  vehicleRadar: Array<{
    vehicleId: string;
    vehicleName: string;
    fuelEfficiency: number;
    maintenanceCost: number;
    reliability: number;
    annualCost: number;
    mileage: number;
  }>;
  dayOfWeekPatterns: Array<{
    day: string;
    fillupCount: number;
    avgCost: number;
    avgGallons: number;
  }>;
  monthlyCostHeatmap: Array<{
    month: string;
    fuel: number;
    maintenance: number;
    financial: number;
    regulatory: number;
    enhancement: number;
    misc: number;
  }>;
  fillupIntervals: Array<{ intervalLabel: string; count: number }>;
}

export interface CrossVehicleData {
  monthlyExpenseTrends: Array<{ month: string; amount: number }>;
  expenseByCategory: Array<{ category: string; amount: number; percentage: number }>;
  vehicleCostComparison: Array<{
    vehicleId: string;
    vehicleName: string;
    totalCost: number;
    costPerMile: number | null;
  }>;
  fuelEfficiencyComparison: Array<{
    month: string;
    vehicles: Array<{ vehicleId: string; vehicleName: string; mpg: number }>;
  }>;
}

export interface FinancingData {
  summary: {
    totalMonthlyPayments: number;
    remainingBalance: number;
    interestPaidYtd: number;
    activeCount: number;
    loanCount: number;
    leaseCount: number;
  };
  vehicleDetails: Array<{
    vehicleId: string;
    vehicleName: string;
    financingType: 'loan' | 'lease' | 'own';
    monthlyPayment: number;
    remainingBalance: number;
    apr: number | null;
    interestPaid: number;
    monthsRemaining: number;
  }>;
  monthlyTimeline: Array<{
    month: string;
    vehicles: Array<{ vehicleId: string; vehicleName: string; amount: number }>;
  }>;
  typeDistribution: Array<{ type: string; value: number; count: number }>;
  loanBreakdown: Array<{ month: string; interest: number; principal: number }>;
}

export interface InsuranceData {
  summary: {
    totalMonthlyPremiums: number;
    totalAnnualPremiums: number;
    activePoliciesCount: number;
  };
  vehicleDetails: Array<{
    vehicleId: string;
    vehicleName: string;
    carrier: string;
    monthlyPremium: number;
    annualPremium: number;
    deductible: number | null;
    coverageType: string | null;
  }>;
  monthlyPremiumTrend: Array<{ month: string; premiums: number }>;
  costByCarrier: Array<{ carrier: string; annualPremium: number; vehicleCount: number }>;
}

export interface VehicleHealthData {
  vehicleId: string;
  vehicleName: string;
  overallScore: number;
  maintenanceRegularity: number;
  mileageIntervalAdherence: number;
  insuranceCoverage: number;
}

export interface VehicleTCOData {
  vehicleId: string;
  vehicleName: string;
  purchasePrice: number | null;
  financingInterest: number;
  insuranceCost: number;
  fuelCost: number;
  maintenanceCost: number;
  otherCosts: number;
  totalCost: number;
  ownershipMonths: number;
  totalMiles: number;
  costPerMile: number | null;
  costPerMonth: number;
  monthlyTrend: Array<{
    month: string;
    financing: number;
    insurance: number;
    fuel: number;
    maintenance: number;
  }>;
}

export interface VehicleExpensesData {
  maintenanceCosts: Array<{ month: string; cost: number }>;
  fuelEfficiencyAndCost: Array<{ month: string; mpg: number | null; cost: number }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
}

export interface YearEndData {
  year: number;
  totalSpent: number;
  categoryBreakdown: Array<{ category: string; amount: number; percentage: number }>;
  mpgTrend: Array<{ month: string; mpg: number }>;
  biggestExpense: { description: string; amount: number; date: string } | null;
  previousYearComparison: { totalSpent: number; percentageChange: number } | null;
  vehicleCount: number;
  totalMiles: number;
  avgMpg: number | null;
  costPerMile: number | null;
}

interface DateRange {
  start: number;
  end: number;
}

export type { DateRange };

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AnalyticsRepository {
  private vehicleNameCache = new Map<string, { data: Map<string, string>; timestamp: number }>();
  private static readonly VEHICLE_NAME_CACHE_TTL = 5_000; // 5 seconds
  private static readonly VEHICLE_NAME_CACHE_MAX_SIZE = 100;

  constructor(private db: BunSQLiteDatabase<Record<string, unknown>>) {}

  // ---- Private helpers ----------------------------------------------------

  private getCachedVehicleNames(cacheKey: string, now: number): Map<string, string> | undefined {
    const cached = this.vehicleNameCache.get(cacheKey);
    if (cached && now - cached.timestamp < AnalyticsRepository.VEHICLE_NAME_CACHE_TTL) {
      return cached.data;
    }
    return undefined;
  }

  private storeVehicleNameCache(cacheKey: string, data: Map<string, string>, now: number): void {
    if (this.vehicleNameCache.size >= AnalyticsRepository.VEHICLE_NAME_CACHE_MAX_SIZE) {
      this.vehicleNameCache.clear();
    }
    this.vehicleNameCache.set(cacheKey, { data, timestamp: now });
  }

  /** Build a map of vehicleId → display name for a user's vehicles. */
  private async queryVehicleNameMap(
    userId: string,
    vehicleId?: string
  ): Promise<Map<string, string>> {
    const now = Date.now();
    const cacheKey = vehicleId ? `${userId}:${vehicleId}` : userId;

    // For single-vehicle queries, check if the all-vehicles cache can satisfy it
    if (vehicleId) {
      const allData = this.getCachedVehicleNames(userId, now);
      const name = allData?.get(vehicleId);
      if (name !== undefined) {
        return new Map<string, string>([[vehicleId, name]]);
      }
    }

    // Check direct cache hit
    const cached = this.getCachedVehicleNames(cacheKey, now);
    if (cached) return cached;

    // Cache miss — query DB
    const conditions = [eq(vehicles.userId, userId)];
    if (vehicleId) conditions.push(eq(vehicles.id, vehicleId));
    const rows = await this.db
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        nickname: vehicles.nickname,
      })
      .from(vehicles)
      .where(and(...conditions));
    const map = new Map<string, string>();
    for (const r of rows) {
      const base = `${r.year} ${r.make} ${r.model}`;
      map.set(r.id, r.nickname ? `${base} (${r.nickname})` : base);
    }

    this.storeVehicleNameCache(cacheKey, map, now);
    return map;
  }

  /** Query fuel expenses for a user, optionally filtered by vehicle and date range. */
  private async queryFuelExpenses(
    userId: string,
    range?: DateRange,
    vehicleId?: string
  ): Promise<FuelExpenseRow[]> {
    const conditions = [eq(vehicles.userId, userId), eq(expenses.category, 'fuel')];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    if (range) {
      conditions.push(sql`${expenses.date} >= ${range.start}`);
      conditions.push(sql`${expenses.date} < ${range.end}`);
    }
    return this.db
      .select({
        date: expenses.date,
        mileage: expenses.mileage,
        fuelAmount: expenses.fuelAmount,
        fuelType: expenses.fuelType,
        missedFillup: expenses.missedFillup,
        expenseAmount: expenses.expenseAmount,
        vehicleId: expenses.vehicleId,
      })
      .from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(and(...conditions))
      .orderBy(asc(expenses.date));
  }

  /** Query all expenses for a user, optionally filtered by vehicle and date range. */
  private async queryAllExpenses(
    userId: string,
    range?: DateRange,
    vehicleId?: string
  ): Promise<GeneralExpenseRow[]> {
    const conditions = [eq(vehicles.userId, userId)];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    if (range) {
      conditions.push(sql`${expenses.date} >= ${range.start}`);
      conditions.push(sql`${expenses.date} < ${range.end}`);
    }
    return this.db
      .select({
        id: expenses.id,
        vehicleId: expenses.vehicleId,
        category: expenses.category,
        description: expenses.description,
        expenseAmount: expenses.expenseAmount,
        date: expenses.date,
        mileage: expenses.mileage,
        fuelAmount: expenses.fuelAmount,
      })
      .from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(and(...conditions))
      .orderBy(asc(expenses.date));
  }

  private async queryTotalSpending(userId: string, year: number): Promise<number> {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const result = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)` })
      .from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicles.userId, userId),
          sql`${expenses.date} >= ${Math.floor(yearStart.getTime() / 1000)}`,
          sql`${expenses.date} < ${Math.floor(yearEnd.getTime() / 1000)}`
        )
      );
    return result[0]?.total ?? 0;
  }
  private async queryFuelAggregates(
    userId: string,
    range: DateRange,
    vehicleId?: string
  ): Promise<{ count: number; totalGallons: number }> {
    const conditions = [
      eq(vehicles.userId, userId),
      eq(expenses.category, 'fuel'),
      sql`${expenses.date} >= ${range.start}`,
      sql`${expenses.date} < ${range.end}`,
    ];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    const result = await this.db
      .select({
        count: sql<number>`COUNT(*)`,
        totalGallons: sql<number>`COALESCE(SUM(${expenses.fuelAmount}), 0)`,
      })
      .from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(and(...conditions));
    return {
      count: result[0]?.count ?? 0,
      totalGallons: result[0]?.totalGallons ?? 0,
    };
  }

  /** Build odometer progression chart data from fuel expenses. */
  private buildOdometerProgression(
    fuelRows: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>
  ): Array<{ month: string; vehicleId: string; vehicleName: string; mileage: number }> {
    const map = new Map<string, { mileage: number }>();
    for (const row of fuelRows) {
      if (row.mileage == null || !row.date) continue;
      const d = row.date instanceof Date ? row.date : new Date(row.date);
      const key = `${toMonthKey(d)}|${row.vehicleId}`;
      const existing = map.get(key);
      if (!existing || row.mileage > existing.mileage) {
        map.set(key, { mileage: row.mileage });
      }
    }
    return Array.from(map.entries())
      .map(([key, data]) => {
        const [month, vId] = key.split('|') as [string, string];
        return {
          month,
          vehicleId: vId,
          vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
          mileage: data.mileage,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-120);
  }

  // ---- Financing helpers --------------------------------------------------

  /** Build vehicle financing details from active financing rows. */
  private buildFinancingVehicleDetails(
    financingRows: Array<{
      id: string;
      vehicleId: string;
      isActive: boolean;
      financingType: string;
      paymentAmount: number;
      currentBalance: number;
      apr: number | null;
      termMonths: number;
      startDate: Date | null;
    }>,
    vehicleNameMap: Map<string, string>
  ): {
    vehicleDetails: FinancingData['vehicleDetails'];
    totalMonthlyPayments: number;
    remainingBalance: number;
    loanCount: number;
    leaseCount: number;
    activeIds: Set<string>;
  } {
    const vehicleDetails: FinancingData['vehicleDetails'] = [];
    let totalMonthlyPayments = 0;
    let remainingBalance = 0;
    let loanCount = 0;
    let leaseCount = 0;
    const activeIds = new Set<string>();

    for (const fin of financingRows) {
      if (!fin.isActive) continue;
      activeIds.add(fin.id);
      totalMonthlyPayments += fin.paymentAmount;
      remainingBalance += fin.currentBalance;
      if (fin.financingType === 'loan') loanCount++;
      if (fin.financingType === 'lease') leaseCount++;
      vehicleDetails.push(this.buildSingleFinancingDetail(fin, vehicleNameMap));
    }

    // Add unfinanced vehicles as 'own'
    for (const [vId, vName] of vehicleNameMap) {
      if (!financingRows.some((f) => f.vehicleId === vId && f.isActive)) {
        vehicleDetails.push({
          vehicleId: vId,
          vehicleName: vName,
          financingType: 'own',
          monthlyPayment: 0,
          remainingBalance: 0,
          apr: null,
          interestPaid: 0,
          monthsRemaining: 0,
        });
      }
    }

    return {
      vehicleDetails,
      totalMonthlyPayments,
      remainingBalance,
      loanCount,
      leaseCount,
      activeIds,
    };
  }

  /** Build a single financing detail entry. */
  private buildSingleFinancingDetail(
    fin: {
      vehicleId: string;
      financingType: string;
      paymentAmount: number;
      currentBalance: number;
      apr: number | null;
      termMonths: number;
      startDate: Date | null;
    },
    vehicleNameMap: Map<string, string>
  ): FinancingData['vehicleDetails'][number] {
    const interestPaid =
      fin.financingType === 'loan' && fin.apr ? (fin.currentBalance * (fin.apr / 100)) / 12 : 0;
    const startDate =
      fin.startDate instanceof Date ? fin.startDate : new Date(fin.startDate as unknown as number);
    const now = new Date();
    const monthsElapsed = Math.max(
      0,
      (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth())
    );
    return {
      vehicleId: fin.vehicleId,
      vehicleName: vehicleNameMap.get(fin.vehicleId) ?? 'Unknown',
      financingType: fin.financingType as 'loan' | 'lease' | 'own',
      monthlyPayment: fin.paymentAmount,
      remainingBalance: fin.currentBalance,
      apr: fin.apr,
      interestPaid,
      monthsRemaining: Math.max(0, fin.termMonths - monthsElapsed),
    };
  }

  /** Project monthly payment timeline forward from vehicle details. */
  private buildFinancingTimeline(
    vehicleDetails: FinancingData['vehicleDetails']
  ): FinancingData['monthlyTimeline'] {
    const now = new Date();
    const maxMonths = Math.max(
      ...vehicleDetails.map((d) => d.monthsRemaining).filter((m) => m > 0),
      0
    );
    const timeline: FinancingData['monthlyTimeline'] = [];
    for (let m = 0; m < Math.min(maxMonths, 24); m++) {
      const monthKey = toMonthKey(new Date(now.getFullYear(), now.getMonth() + m, 1));
      const monthVehicles = vehicleDetails
        .filter((d) => d.monthsRemaining > m && d.monthlyPayment > 0)
        .map((d) => ({
          vehicleId: d.vehicleId,
          vehicleName: d.vehicleName,
          amount: d.monthlyPayment,
        }));
      if (monthVehicles.length > 0) timeline.push({ month: monthKey, vehicles: monthVehicles });
    }
    return timeline;
  }

  /** Build loan interest/principal breakdown for the next 12 months. */
  private buildLoanBreakdown(
    financingRows: Array<{
      isActive: boolean;
      financingType: string;
      apr: number | null;
      currentBalance: number;
      paymentAmount: number;
    }>
  ): FinancingData['loanBreakdown'] {
    const activeLoans = financingRows.filter(
      (f) => f.isActive && f.financingType === 'loan' && f.apr
    );
    if (activeLoans.length === 0) return [];
    const now = new Date();
    const breakdown: FinancingData['loanBreakdown'] = [];
    for (let m = 0; m < 12; m++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() + m, 1);
      let totalInterest = 0;
      let totalPrincipal = 0;
      for (const loan of activeLoans) {
        const interest = loan.currentBalance * ((loan.apr ?? 0) / 100 / 12);
        totalInterest += Math.max(0, interest);
        totalPrincipal += Math.max(0, loan.paymentAmount - interest);
      }
      breakdown.push({
        month: toMonthKey(monthDate),
        interest: totalInterest,
        principal: totalPrincipal,
      });
    }
    return breakdown;
  }

  // ---- Insurance helpers --------------------------------------------------

  /** Process active policies into vehicle details and aggregation maps. */
  /** Process active policies into vehicle details and aggregation maps. */
  private buildInsuranceDetails(
    activePolicies: Array<{ id: string; company: string; terms: PolicyTerm[] | null }>,
    junctionRows: Array<{ policyId: string; vehicleId: string }>,
    vehicleNameMap: Map<string, string>
  ): {
    vehicleDetails: InsuranceData['vehicleDetails'];
    totalMonthlyPremiums: number;
    totalAnnualPremiums: number;
    carrierMap: Map<string, { annualPremium: number; vehicleIds: Set<string> }>;
    monthlyMap: Map<string, number>;
  } {
    let totalMonthlyPremiums = 0;
    let totalAnnualPremiums = 0;
    const vehicleDetails: InsuranceData['vehicleDetails'] = [];
    const carrierMap = new Map<string, { annualPremium: number; vehicleIds: Set<string> }>();
    const monthlyMap = new Map<string, number>();

    for (const policy of activePolicies) {
      const terms = (policy.terms ?? []) as PolicyTerm[];
      const latestTerm = terms[terms.length - 1];
      if (!latestTerm) continue;

      const monthlyPremium = latestTerm.financeDetails?.monthlyCost ?? 0;
      const annualPremium = monthlyPremium * 12;
      const coveredVehicleIds = [
        ...new Set(junctionRows.filter((j) => j.policyId === policy.id).map((j) => j.vehicleId)),
      ];

      totalMonthlyPremiums += monthlyPremium;
      totalAnnualPremiums += annualPremium;

      this.accumulateCarrierData(carrierMap, policy.company, annualPremium, coveredVehicleIds);
      this.buildInsuranceVehicleEntries(
        vehicleDetails,
        coveredVehicleIds,
        vehicleNameMap,
        policy.company,
        monthlyPremium,
        annualPremium,
        latestTerm
      );
      this.accumulateMonthlyPremiums(monthlyMap, latestTerm, monthlyPremium);
    }

    return { vehicleDetails, totalMonthlyPremiums, totalAnnualPremiums, carrierMap, monthlyMap };
  }

  /** Accumulate carrier-level premium data. */
  private accumulateCarrierData(
    carrierMap: Map<string, { annualPremium: number; vehicleIds: Set<string> }>,
    company: string,
    annualPremium: number,
    coveredVehicleIds: string[]
  ): void {
    const entry = carrierMap.get(company) ?? { annualPremium: 0, vehicleIds: new Set<string>() };
    entry.annualPremium += annualPremium;
    for (const vId of coveredVehicleIds) entry.vehicleIds.add(vId);
    carrierMap.set(company, entry);
  }

  /** Build per-vehicle insurance detail entries. */
  private buildInsuranceVehicleEntries(
    vehicleDetails: InsuranceData['vehicleDetails'],
    coveredVehicleIds: string[],
    vehicleNameMap: Map<string, string>,
    carrier: string,
    monthlyPremium: number,
    annualPremium: number,
    term: PolicyTerm
  ): void {
    const perVehicleMonthly =
      coveredVehicleIds.length > 0 ? monthlyPremium / coveredVehicleIds.length : 0;
    const perVehicleAnnual =
      coveredVehicleIds.length > 0 ? annualPremium / coveredVehicleIds.length : 0;
    for (const vId of coveredVehicleIds) {
      vehicleDetails.push({
        vehicleId: vId,
        vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
        carrier,
        monthlyPremium: perVehicleMonthly,
        annualPremium: perVehicleAnnual,
        deductible: term.policyDetails?.deductibleAmount ?? null,
        coverageType: term.policyDetails?.coverageDescription ?? null,
      });
    }
  }

  /** Accumulate monthly premium data from a policy term's date range. */
  private accumulateMonthlyPremiums(
    monthlyMap: Map<string, number>,
    term: PolicyTerm,
    monthlyPremium: number
  ): void {
    if (!term.startDate || !term.endDate) return;
    const start = new Date(term.startDate);
    const end = new Date(term.endDate);
    const current = new Date(start);
    while (current <= end) {
      const key = toMonthKey(current);
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + monthlyPremium);
      current.setMonth(current.getMonth() + 1);
    }
  }

  // ---- TCO helpers --------------------------------------------------------

  /** Categorize expenses into TCO cost buckets. */
  private categorizeTCOExpenses(
    rows: Array<{
      category: string;
      expenseAmount: number;
      isFinancingPayment: boolean;
      insurancePolicyId: string | null;
    }>
  ): {
    financingInterest: number;
    insuranceCost: number;
    fuelCost: number;
    maintenanceCost: number;
    otherCosts: number;
  } {
    let financingInterest = 0;
    let insuranceCost = 0;
    let fuelCost = 0;
    let maintenanceCost = 0;
    let otherCosts = 0;
    for (const row of rows) {
      if (row.category === 'financial' && row.isFinancingPayment)
        financingInterest += row.expenseAmount;
      else if (row.category === 'financial' && row.insurancePolicyId)
        insuranceCost += row.expenseAmount;
      else if (row.category === 'fuel') fuelCost += row.expenseAmount;
      else if (row.category === 'maintenance') maintenanceCost += row.expenseAmount;
      else otherCosts += row.expenseAmount;
    }
    return { financingInterest, insuranceCost, fuelCost, maintenanceCost, otherCosts };
  }

  // ---- Public API methods -------------------------------------------------

  /** Compute fuel efficiency trend from sequential fuel expenses. */
  async getFuelEfficiencyTrend(userId: string, vehicleId?: string): Promise<FuelEfficiencyPoint[]> {
    try {
      const conditions = [
        eq(vehicles.userId, userId),
        eq(expenses.category, 'fuel'),
        isNotNull(expenses.mileage),
        isNotNull(expenses.fuelAmount),
      ];
      if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
      const rows = await this.db
        .select({
          date: expenses.date,
          mileage: expenses.mileage,
          fuelAmount: expenses.fuelAmount,
          fuelType: expenses.fuelType,
          missedFillup: expenses.missedFillup,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.date));
      if (rows.length < 2) return [];
      const points: FuelEfficiencyPoint[] = [];
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) continue;
        const point = computeEfficiencyPoint(current as FuelRow, previous as FuelRow);
        if (point) points.push(point);
      }
      return points;
    } catch (error) {
      logger.error('Failed to compute fuel efficiency trend', {
        userId,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute fuel efficiency trend', error);
    }
  }

  /** Compute quick stats: vehicle count, YTD spending, avg MPG, fleet health. */
  async getQuickStats(userId: string, range: DateRange): Promise<QuickStatsData> {
    try {
      // 1. Get vehicles with insurance policy IDs in one query
      const vehicleRows = await this.db
        .select({
          id: vehicles.id,
          currentInsurancePolicyId: vehicles.currentInsurancePolicyId,
        })
        .from(vehicles)
        .where(eq(vehicles.userId, userId));

      const vehicleCount = vehicleRows.length;

      // 2. Get all expenses for the range and fuel efficiency in parallel
      const [allExpenses, fuelRows] = await Promise.all([
        this.queryAllExpenses(userId, range),
        this.queryFuelExpenses(userId, range),
      ]);

      const ytdSpending = allExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
      const fuelRowsByVehicle = [...fuelRows].sort((a, b) => {
        if (a.vehicleId !== b.vehicleId) return a.vehicleId.localeCompare(b.vehicleId);
        const aTime = a.date instanceof Date ? a.date.getTime() : Number(a.date);
        const bTime = b.date instanceof Date ? b.date.getTime() : Number(b.date);
        return aTime - bTime;
      });
      const { mpgValues } = computeMpgAndCostPerMile(fuelRowsByVehicle);
      const avgMpg =
        mpgValues.length > 0 ? mpgValues.reduce((a, b) => a + b, 0) / mpgValues.length : null;

      // 3. Compute fleet health score in batch (no N+1)
      const fleetHealthScore =
        vehicleCount > 0 ? await this.computeFleetHealthScore(vehicleRows) : 0;

      return { vehicleCount, ytdSpending, avgMpg, fleetHealthScore };
    } catch (error) {
      logger.error('Failed to compute quick stats', {
        userId,
        range,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute quick stats', error);
    }
  }

  /** Batch-compute fleet health score across all vehicles without N+1 queries. */
  private async computeFleetHealthScore(
    vehicleRows: Array<{ id: string; currentInsurancePolicyId: string | null }>
  ): Promise<number> {
    const vehicleIds = vehicleRows.map((v) => v.id);

    // Single query for ALL maintenance expenses across all vehicles
    const allMaintenance = await this.db
      .select({
        vehicleId: expenses.vehicleId,
        date: expenses.date,
        mileage: expenses.mileage,
      })
      .from(expenses)
      .where(and(inArray(expenses.vehicleId, vehicleIds), eq(expenses.category, 'maintenance')))
      .orderBy(asc(expenses.date));

    // Group maintenance by vehicle
    const maintenanceByVehicle = new Map<
      string,
      Array<{ date: Date | null; mileage: number | null }>
    >();
    for (const row of allMaintenance) {
      let arr = maintenanceByVehicle.get(row.vehicleId);
      if (!arr) {
        arr = [];
        maintenanceByVehicle.set(row.vehicleId, arr);
      }
      arr.push({ date: row.date, mileage: row.mileage });
    }

    // Batch-query all active insurance policies
    const activePolicyIds = await this.queryActivePolicyIds(vehicleRows);

    // Compute per-vehicle scores without individual DB calls
    let totalScore = 0;
    for (const v of vehicleRows) {
      const maint = maintenanceByVehicle.get(v.id) ?? [];
      const maintenanceRegularity = computeRegularityScore(maint);
      const mileageAdherence = computeMileageScore(maint);
      const insuranceCoverage =
        v.currentInsurancePolicyId && activePolicyIds.has(v.currentInsurancePolicyId) ? 100 : 0;
      totalScore += Math.round(
        maintenanceRegularity * 0.4 + mileageAdherence * 0.35 + insuranceCoverage * 0.25
      );
    }
    return Math.round(totalScore / vehicleRows.length);
  }

  /** Query active insurance policy IDs for a set of vehicles in one batch. */
  private async queryActivePolicyIds(
    vehicleRows: Array<{ currentInsurancePolicyId: string | null }>
  ): Promise<Set<string>> {
    const policyIds = vehicleRows
      .map((v) => v.currentInsurancePolicyId)
      .filter((id): id is string => id != null);

    if (policyIds.length === 0) return new Set();

    const policyRows = await this.db
      .select({ id: insurancePolicies.id })
      .from(insurancePolicies)
      .where(and(inArray(insurancePolicies.id, policyIds), eq(insurancePolicies.isActive, true)));

    return new Set(policyRows.map((p) => p.id));
  }

  /** Compute fuel stats: fillup counts, consumption metrics, charts. */
  async getFuelStats(userId: string, range: DateRange, vehicleId?: string): Promise<FuelStatsData> {
    try {
      const prevRange: DateRange = {
        start: range.start - (range.end - range.start),
        end: range.start,
      };
      const [vehicleNameMap, fuelRows, prevYearAgg] = await Promise.all([
        this.queryVehicleNameMap(userId, vehicleId),
        this.queryFuelExpenses(userId, range, vehicleId),
        this.queryFuelAggregates(userId, prevRange, vehicleId),
      ]);
      const now = new Date();
      const currentMonth = now.getMonth();
      const rangeStartDate = new Date(range.start * 1000);
      const rangeEndDate = new Date(range.end * 1000);

      const toDate = (r: FuelExpenseRow) =>
        r.date instanceof Date ? r.date : new Date(r.date as unknown as number);
      const currentYearFillups = fuelRows.length;
      const previousYearFillups = prevYearAgg.count;
      const currentMonthFillups = fuelRows.filter(
        (r) => toDate(r).getMonth() === currentMonth
      ).length;
      const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const prevMonthFillups = fuelRows.filter((r) => toDate(r).getMonth() === prevMonth).length;

      const sumGallons = (rows: FuelExpenseRow[]) =>
        rows.reduce((s, r) => s + (r.fuelAmount ?? 0), 0);
      const currentYearGallons = sumGallons(fuelRows);
      const previousYearGallons = prevYearAgg.totalGallons;
      const currentMonthGallons = sumGallons(
        fuelRows.filter((r) => toDate(r).getMonth() === currentMonth)
      );
      const prevMonthGallons = sumGallons(
        fuelRows.filter((r) => toDate(r).getMonth() === prevMonth)
      );

      // Sort by vehicleId then date for functions that need consecutive same-vehicle pairs
      const fuelRowsByVehicle = [...fuelRows].sort((a, b) => {
        if (a.vehicleId !== b.vehicleId) return a.vehicleId.localeCompare(b.vehicleId);
        const aTime = a.date instanceof Date ? a.date.getTime() : Number(a.date);
        const bTime = b.date instanceof Date ? b.date.getTime() : Number(b.date);
        return aTime - bTime;
      });

      const { mpgValues, costPerMileValues } = computeMpgAndCostPerMile(fuelRowsByVehicle);
      const fuelConsumption = computeFuelConsumptionMetrics(mpgValues);

      const volumes = fuelRows
        .filter((r) => r.fuelAmount != null && r.fuelAmount > 0)
        .map((r) => r.fuelAmount as number);
      const fillupDetails = {
        avgVolume: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
        minVolume: volumes.length > 0 ? Math.min(...volumes) : null,
        maxVolume: volumes.length > 0 ? Math.max(...volumes) : null,
      };

      const averageCost = computeAverageCosts(
        fuelRows,
        costPerMileValues,
        rangeStartDate,
        rangeEndDate,
        now
      );

      const mileages = fuelRows.filter((r) => r.mileage != null).map((r) => r.mileage as number);
      const totalMiles = mileages.length >= 2 ? Math.max(...mileages) - Math.min(...mileages) : 0;
      const daysSoFar = Math.max(
        1,
        Math.ceil(
          (Math.min(now.getTime(), rangeEndDate.getTime()) - rangeStartDate.getTime()) / 86400000
        )
      );
      const distance = {
        totalMiles,
        avgPerDay: totalMiles > 0 ? totalMiles / daysSoFar : null,
        avgPerMonth: totalMiles > 0 ? totalMiles / Math.max(1, Math.ceil(daysSoFar / 30)) : null,
      };

      return {
        fillups: {
          currentYear: currentYearFillups,
          previousYear: previousYearFillups,
          currentMonth: currentMonthFillups,
          previousMonth: prevMonthFillups,
        },
        gallons: {
          currentYear: currentYearGallons,
          previousYear: previousYearGallons,
          currentMonth: currentMonthGallons,
          previousMonth: prevMonthGallons,
        },
        fuelConsumption,
        fillupDetails,
        averageCost,
        distance,
        monthlyConsumption: buildMonthlyConsumption(fuelRowsByVehicle),
        gasPriceHistory: buildGasPriceHistory(fuelRows),
        fillupCostByVehicle: buildFillupCostByVehicle(fuelRows, vehicleNameMap),
        odometerProgression: this.buildOdometerProgression(fuelRows, vehicleNameMap),
        costPerMile: buildCostPerMileChart(fuelRowsByVehicle, vehicleNameMap),
      };
    } catch (error) {
      logger.error('Failed to compute fuel stats', {
        userId,
        range,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute fuel stats', error);
    }
  }

  /** Compute fuel advanced analytics: maintenance timeline, radar, heatmap, etc. */
  async getFuelAdvanced(
    userId: string,
    range: DateRange,
    vehicleId?: string
  ): Promise<FuelAdvancedData> {
    try {
      const [vehicleNameMap, fuelRows, allExpenses] = await Promise.all([
        this.queryVehicleNameMap(userId, vehicleId),
        this.queryFuelExpenses(userId, range, vehicleId),
        this.queryAllExpenses(userId, range, vehicleId),
      ]);
      const maintenanceRows = allExpenses.filter((e) => e.category === 'maintenance');
      // Sort by vehicleId then date for functions that need consecutive same-vehicle pairs
      const fuelRowsByVehicle = [...fuelRows].sort((a, b) => {
        if (a.vehicleId !== b.vehicleId) return a.vehicleId.localeCompare(b.vehicleId);
        const aTime = a.date instanceof Date ? a.date.getTime() : Number(a.date);
        const bTime = b.date instanceof Date ? b.date.getTime() : Number(b.date);
        return aTime - bTime;
      });
      return {
        maintenanceTimeline: buildMaintenanceTimeline(maintenanceRows, new Date()),
        seasonalEfficiency: buildSeasonalEfficiency(fuelRowsByVehicle),
        vehicleRadar: buildVehicleRadar(allExpenses, fuelRowsByVehicle, vehicleNameMap),
        dayOfWeekPatterns: buildDayOfWeekPatterns(fuelRows),
        monthlyCostHeatmap: buildMonthlyCostHeatmap(allExpenses),
        fillupIntervals: buildFillupIntervals(fuelRows),
      };
    } catch (error) {
      logger.error('Failed to compute fuel advanced analytics', {
        userId,
        range,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute fuel advanced analytics', error);
    }
  }

  /** Compute cross-vehicle analytics: trends, category breakdown, comparisons. */
  async getCrossVehicle(userId: string, range: DateRange): Promise<CrossVehicleData> {
    try {
      const [vehicleNameMap, allExpenses, fuelRows] = await Promise.all([
        this.queryVehicleNameMap(userId),
        this.queryAllExpenses(userId, range),
        this.queryFuelExpenses(userId, range),
      ]);

      const vehicleCosts = new Map<
        string,
        { total: number; maxMileage: number; minMileage: number }
      >();
      for (const row of allExpenses) {
        const entry = vehicleCosts.get(row.vehicleId) ?? {
          total: 0,
          maxMileage: 0,
          minMileage: Number.POSITIVE_INFINITY,
        };
        entry.total += row.expenseAmount;
        if (row.mileage != null) {
          entry.maxMileage = Math.max(entry.maxMileage, row.mileage);
          entry.minMileage = Math.min(entry.minMileage, row.mileage);
        }
        vehicleCosts.set(row.vehicleId, entry);
      }
      const vehicleCostComparison = [...vehicleNameMap.entries()].map(([vId, vName]) => {
        const data = vehicleCosts.get(vId);
        const totalCost = data?.total ?? 0;
        const totalMiles =
          data && data.maxMileage > 0 && data.minMileage < Number.POSITIVE_INFINITY
            ? data.maxMileage - data.minMileage
            : 0;
        return {
          vehicleId: vId,
          vehicleName: vName,
          totalCost,
          costPerMile: totalMiles > 0 ? totalCost / totalMiles : null,
        };
      });

      return {
        monthlyExpenseTrends: buildMonthlyExpenseTrends(allExpenses),
        expenseByCategory: buildExpenseByCategory(allExpenses),
        vehicleCostComparison,
        fuelEfficiencyComparison: buildFuelEfficiencyComparison(fuelRows, vehicleNameMap),
      };
    } catch (error) {
      logger.error('Failed to compute cross-vehicle analytics', {
        userId,
        range,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute cross-vehicle analytics', error);
    }
  }

  /** Compute financing analytics: summary, vehicle details, timeline. */
  async getFinancing(userId: string): Promise<FinancingData> {
    try {
      const vehicleNameMap = await this.queryVehicleNameMap(userId);
      const userVehicleIds = [...vehicleNameMap.keys()];
      if (userVehicleIds.length === 0) {
        return {
          summary: {
            totalMonthlyPayments: 0,
            remainingBalance: 0,
            interestPaidYtd: 0,
            activeCount: 0,
            loanCount: 0,
            leaseCount: 0,
          },
          vehicleDetails: [],
          monthlyTimeline: [],
          typeDistribution: [],
          loanBreakdown: [],
        };
      }

      const financingRows = await this.db
        .select()
        .from(vehicleFinancing)
        .where(inArray(vehicleFinancing.vehicleId, userVehicleIds));
      const {
        vehicleDetails,
        totalMonthlyPayments,
        remainingBalance,
        loanCount,
        leaseCount,
        activeIds,
      } = this.buildFinancingVehicleDetails(financingRows, vehicleNameMap);

      const monthlyTimeline = this.buildFinancingTimeline(vehicleDetails);

      // Type distribution
      const typeMap = new Map<string, { value: number; count: number }>();
      for (const d of vehicleDetails) {
        const entry = typeMap.get(d.financingType) ?? { value: 0, count: 0 };
        entry.value += d.monthlyPayment;
        entry.count++;
        typeMap.set(d.financingType, entry);
      }
      const typeDistribution = Array.from(typeMap.entries()).map(([type, data]) => ({
        type,
        value: data.value,
        count: data.count,
      }));

      return {
        summary: {
          totalMonthlyPayments,
          remainingBalance,
          interestPaidYtd: vehicleDetails.reduce((s, d) => s + d.interestPaid, 0),
          activeCount: activeIds.size,
          loanCount,
          leaseCount,
        },
        vehicleDetails,
        monthlyTimeline,
        typeDistribution,
        loanBreakdown: this.buildLoanBreakdown(financingRows),
      };
    } catch (error) {
      logger.error('Failed to compute financing analytics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute financing analytics', error);
    }
  }

  /** Compute insurance analytics: summary, vehicle details, premium trends. */
  async getInsurance(userId: string): Promise<InsuranceData> {
    try {
      const vehicleNameMap = await this.queryVehicleNameMap(userId);
      const userVehicleIds = [...vehicleNameMap.keys()];
      const emptyResult: InsuranceData = {
        summary: { totalMonthlyPremiums: 0, totalAnnualPremiums: 0, activePoliciesCount: 0 },
        vehicleDetails: [],
        monthlyPremiumTrend: [],
        costByCarrier: [],
      };
      if (userVehicleIds.length === 0) return emptyResult;

      const junctionRows = await this.db
        .select({
          policyId: insurancePolicyVehicles.policyId,
          termId: insurancePolicyVehicles.termId,
          vehicleId: insurancePolicyVehicles.vehicleId,
        })
        .from(insurancePolicyVehicles)
        .where(inArray(insurancePolicyVehicles.vehicleId, userVehicleIds));
      const policyIds = [...new Set(junctionRows.map((r) => r.policyId))];
      if (policyIds.length === 0) return emptyResult;

      const policyRows = await this.db
        .select()
        .from(insurancePolicies)
        .where(inArray(insurancePolicies.id, policyIds));
      const activePolicies = policyRows.filter((p) => p.isActive);

      const { vehicleDetails, totalMonthlyPremiums, totalAnnualPremiums, carrierMap, monthlyMap } =
        this.buildInsuranceDetails(activePolicies, junctionRows, vehicleNameMap);

      return {
        summary: {
          totalMonthlyPremiums,
          totalAnnualPremiums,
          activePoliciesCount: activePolicies.length,
        },
        vehicleDetails,
        monthlyPremiumTrend: Array.from(monthlyMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, premiums]) => ({ month, premiums })),
        costByCarrier: Array.from(carrierMap.entries()).map(([carrier, data]) => ({
          carrier,
          annualPremium: data.annualPremium,
          vehicleCount: data.vehicleIds.size,
        })),
      };
    } catch (error) {
      logger.error('Failed to compute insurance analytics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute insurance analytics', error);
    }
  }

  /** Compute vehicle health score from maintenance regularity, mileage, and insurance. */
  async getVehicleHealth(userId: string, vehicleId: string): Promise<VehicleHealthData> {
    try {
      const [vehicleNameMap, vehicleRows, maintenanceRows] = await Promise.all([
        this.queryVehicleNameMap(userId, vehicleId),
        this.db
          .select({ currentInsurancePolicyId: vehicles.currentInsurancePolicyId })
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
          .limit(1),
        this.db
          .select({ date: expenses.date, mileage: expenses.mileage })
          .from(expenses)
          .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, 'maintenance')))
          .orderBy(asc(expenses.date)),
      ]);

      const vehicleName = vehicleNameMap.get(vehicleId) ?? 'Unknown';
      const policyId = vehicleRows[0]?.currentInsurancePolicyId ?? null;
      const activePolicyIds = policyId
        ? await this.queryActivePolicyIds([{ currentInsurancePolicyId: policyId }])
        : new Set<string>();

      const maintenanceRegularity = computeRegularityScore(maintenanceRows);
      const mileageIntervalAdherence = computeMileageScore(maintenanceRows);
      const insuranceCoverage = policyId && activePolicyIds.has(policyId) ? 100 : 0;
      const overallScore = Math.round(
        maintenanceRegularity * 0.4 + mileageIntervalAdherence * 0.35 + insuranceCoverage * 0.25
      );

      return {
        vehicleId,
        vehicleName,
        overallScore,
        maintenanceRegularity,
        mileageIntervalAdherence,
        insuranceCoverage,
      };
    } catch (error) {
      logger.error('Failed to compute vehicle health', {
        userId,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute vehicle health', error);
    }
  }

  /** Compute total cost of ownership for a vehicle. */
  async getVehicleTCO(userId: string, vehicleId: string, year?: number): Promise<VehicleTCOData> {
    try {
      const [vehicleNameMap, vehicleRows] = await Promise.all([
        this.queryVehicleNameMap(userId, vehicleId),
        this.db
          .select({ purchasePrice: vehicles.purchasePrice, purchaseDate: vehicles.purchaseDate })
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), eq(vehicles.userId, userId)))
          .limit(1),
      ]);
      const vehicleName = vehicleNameMap.get(vehicleId) ?? 'Unknown';
      const vehicle = vehicleRows[0];
      const purchasePrice = vehicle?.purchasePrice ?? null;
      const purchaseDate = vehicle?.purchaseDate ?? null;

      const conditions = [eq(expenses.vehicleId, vehicleId), eq(vehicles.userId, userId)];
      if (year) {
        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);
        conditions.push(sql`${expenses.date} >= ${Math.floor(yearStart.getTime() / 1000)}`);
        conditions.push(sql`${expenses.date} < ${Math.floor(yearEnd.getTime() / 1000)}`);
      }
      const detailedExpenses = await this.db
        .select({
          category: expenses.category,
          expenseAmount: expenses.expenseAmount,
          date: expenses.date,
          isFinancingPayment: expenses.isFinancingPayment,
          insurancePolicyId: expenses.insurancePolicyId,
          mileage: expenses.mileage,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.date));

      const costs = this.categorizeTCOExpenses(detailedExpenses);
      const totalCost =
        (purchasePrice ?? 0) +
        costs.financingInterest +
        costs.insuranceCost +
        costs.fuelCost +
        costs.maintenanceCost +
        costs.otherCosts;

      const now = new Date();
      const ownershipStart =
        purchaseDate instanceof Date
          ? purchaseDate
          : purchaseDate
            ? new Date(purchaseDate as unknown as number)
            : now;
      const ownershipMonths = Math.max(
        1,
        (now.getFullYear() - ownershipStart.getFullYear()) * 12 +
          (now.getMonth() - ownershipStart.getMonth())
      );
      const mileages = detailedExpenses
        .filter((r) => r.mileage != null)
        .map((r) => r.mileage as number);
      const totalMiles = mileages.length >= 2 ? Math.max(...mileages) - Math.min(...mileages) : 0;

      return {
        vehicleId,
        vehicleName,
        purchasePrice,
        ...costs,
        totalCost,
        ownershipMonths,
        totalMiles,
        costPerMile: totalMiles > 0 ? totalCost / totalMiles : null,
        costPerMonth: totalCost / ownershipMonths,
        monthlyTrend: buildTCOMonthlyTrend(detailedExpenses),
      };
    } catch (error) {
      logger.error('Failed to compute vehicle TCO', {
        userId,
        vehicleId,
        year,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute vehicle TCO', error);
    }
  }

  /** Compute per-vehicle expense charts: maintenance costs, fuel efficiency, breakdown. */
  async getVehicleExpenses(
    userId: string,
    vehicleId: string,
    range: DateRange
  ): Promise<VehicleExpensesData> {
    try {
      const allExpenses = await this.queryAllExpenses(userId, range, vehicleId);
      const fuelRows = allExpenses.filter((e) => e.category === 'fuel');
      return {
        maintenanceCosts: buildVehicleMaintenanceCosts(allExpenses),
        fuelEfficiencyAndCost: buildFuelEfficiencyAndCost(fuelRows),
        expenseBreakdown: buildVehicleExpenseBreakdown(allExpenses),
      };
    } catch (error) {
      logger.error('Failed to compute vehicle expenses', {
        userId,
        vehicleId,
        range,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute vehicle expenses', error);
    }
  }

  /** Compute year-end summary: totals, trends, biggest expense, YoY comparison. */
  async getYearEnd(userId: string, year: number): Promise<YearEndData> {
    try {
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year + 1, 0, 1);
      const yearRange: DateRange = {
        start: Math.floor(yearStart.getTime() / 1000),
        end: Math.floor(yearEnd.getTime() / 1000),
      };
      const [vehicleNameMap, allExpenses, fuelRows, prevTotalSpent] = await Promise.all([
        this.queryVehicleNameMap(userId),
        this.queryAllExpenses(userId, yearRange),
        this.queryFuelExpenses(userId, yearRange),
        this.queryTotalSpending(userId, year - 1),
      ]);

      const totalSpent = allExpenses.reduce((s, e) => s + e.expenseAmount, 0);

      const mileages = fuelRows.filter((r) => r.mileage != null).map((r) => r.mileage as number);
      const totalMiles = mileages.length >= 2 ? Math.max(...mileages) - Math.min(...mileages) : 0;
      // Sort by vehicleId then date for functions that need consecutive same-vehicle pairs
      const fuelRowsByVehicle = [...fuelRows].sort((a, b) => {
        if (a.vehicleId !== b.vehicleId) return a.vehicleId.localeCompare(b.vehicleId);
        const aTime = a.date instanceof Date ? a.date.getTime() : Number(a.date);
        const bTime = b.date instanceof Date ? b.date.getTime() : Number(b.date);
        return aTime - bTime;
      });
      const { mpgValues } = computeMpgAndCostPerMile(fuelRowsByVehicle);
      const avgMpg =
        mpgValues.length > 0 ? mpgValues.reduce((a, b) => a + b, 0) / mpgValues.length : null;

      return {
        year,
        totalSpent,
        categoryBreakdown: buildExpenseByCategory(allExpenses),
        mpgTrend: buildMpgTrend(fuelRowsByVehicle),
        biggestExpense: findBiggestExpense(allExpenses),
        previousYearComparison: computePreviousYearComparison(totalSpent, prevTotalSpent),
        vehicleCount: vehicleNameMap.size,
        totalMiles,
        avgMpg,
        costPerMile: totalMiles > 0 ? totalSpent / totalMiles : null,
      };
    } catch (error) {
      logger.error('Failed to compute year-end summary', {
        userId,
        year,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute year-end summary', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const analyticsRepository = new AnalyticsRepository(getDb());
