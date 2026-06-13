import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import {
  expenses,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  userPreferences,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { DatabaseError, ValidationError } from '../../errors';
import { DEFAULT_UNIT_PREFERENCES, parseUnitPreferences, type UnitPreferences } from '../../types';
import {
  buildAmortizationSchedule,
  buildCostPerDistanceChart,
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
  effectiveMonthlyPremium,
  type FuelEfficiencyPoint,
  type FuelExpenseRow,
  type FuelRow,
  findBiggestExpense,
  forEachVehiclePair,
  type GeneralExpenseRow,
  groupByVehicle,
  isFillup,
  monthKeysInRange,
  sortByVehicleThenDate,
  toMonthKey,
} from '../../utils/analytics-charts';
import { maxOf, minOf } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { convertDistance, convertEfficiency } from '../../utils/unit-conversions';

export type { FuelEfficiencyPoint } from '../../utils/analytics-charts';

/**
 * How many calendar months of `year` the vehicle was owned, bounded by [ownershipStart, now]
 * (C121/#28). Used to divide a YEAR-scoped TCO total by a matching span instead of full-ownership
 * months. Inclusive of both endpoint months: a vehicle owned all of `year` → 12; bought in July of
 * `year` → 6 (Jul–Dec); a FUTURE year (start after year-end) or one entirely before ownership → 0.
 * Pure (no Date.now() inside — `now` is injected by the caller), so it's host-independent + testable.
 */
export function monthsOwnedInYear(ownershipStart: Date, now: Date, year: number): number {
  const yearStartMonth = ownershipStart.getFullYear() < year ? 0 : ownershipStart.getMonth();
  const yearEndMonth = now.getFullYear() > year ? 11 : now.getMonth();
  // The vehicle wasn't owned during `year` at all (bought after it, or `now` precedes it).
  if (ownershipStart.getFullYear() > year || now.getFullYear() < year) return 0;
  return Math.max(0, yearEndMonth - yearStartMonth + 1);
}

/**
 * Whole CALENDAR months elapsed from `from` to `to` (signed; can be negative if `to` precedes `from`).
 * The year×12 + month-delta expression was hand-repeated at the financing months-elapsed + the all-time
 * TCO ownership-months sites — two money-facing denominators (monthsRemaining; costPerMonth = total /
 * months). ONE source of truth so a divergent copy (a dropped `* 12`, a flipped subtraction) can't skew
 * one path's months against the other. Callers apply their OWN clamp (financing Math.max(0,…),
 * cost-per-month Math.max(1,…)) — this returns the raw count, exactly as both inline expressions did.
 */
export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/**
 * Normalize a date-or-raw-timestamp into a Date (C194 dedup). Drizzle timestamp columns surface as
 * Date, but some rows reach these builders via paths typed loosely (a raw number/string), so the
 * analytics builders defensively coerced with `x instanceof Date ? x : new Date(x)` — hand-repeated at
 * 4 sites (fuel monthly, financing startDate, term start+end). One source of truth; behavior-identical
 * (an already-Date passes through; anything else goes through `new Date`, exactly as before).
 */
export function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The half-open `[Jan 1 of `year`, Jan 1 of `year`+1)` local-time Date boundaries (C216 dedup). The
 * `new Date(year, 0, 1)` / `new Date(year + 1, 0, 1)` pair was hand-repeated at 3 sites
 * (queryTotalSpending, the year-scoped vehicle-expenses filter, getYearEnd) — each then either feeds
 * `gte(start) + lt(end)` (the half-open year filter) or `Math.floor(.getTime()/1000)` (the DateRange
 * seconds form). One source of truth for the boundary pair; behavior-identical (callers consume the
 * two Dates exactly as before). Local-time, matching the existing sites + the rest of the analytics
 * date math.
 */
export function calendarYearRange(year: number): { start: Date; end: Date } {
  return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
}

// ---------------------------------------------------------------------------
// Data interfaces for each analytics endpoint
// ---------------------------------------------------------------------------

export interface QuickStatsData {
  vehicleCount: number;
  ytdSpending: number;
  avgEfficiency: number | null;
  fleetHealthScore: number;
  units: { distanceUnit: string; volumeUnit: string; chargeUnit: string };
}

export interface FuelStatsData {
  fillups: {
    currentYear: number;
    previousYear: number;
    currentMonth: number;
    previousMonth: number;
  };
  volume: {
    currentYear: number;
    previousYear: number;
    currentMonth: number;
    previousMonth: number;
  };
  fuelConsumption: {
    avgEfficiency: number | null;
    bestEfficiency: number | null;
    worstEfficiency: number | null;
  };
  fillupDetails: {
    avgVolume: number | null;
    minVolume: number | null;
    maxVolume: number | null;
  };
  averageCost: {
    perFillup: number | null;
    bestCostPerDistance: number | null;
    worstCostPerDistance: number | null;
    avgCostPerDay: number | null;
  };
  distance: {
    totalDistance: number;
    avgPerDay: number | null;
    avgPerMonth: number | null;
  };
  monthlyConsumption: Array<{ month: string; efficiency: number; volume: number }>;
  gasPriceHistory: Array<{ date: string; fuelType: string; pricePerVolume: number }>;
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
  costPerDistance: Array<{
    month: string;
    vehicleId: string;
    vehicleName: string;
    costPerDistance: number;
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
  seasonalEfficiency: Array<{ season: string; avgEfficiency: number; fillupCount: number }>;
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
    avgVolume: number;
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
    costPerDistance: number | null;
  }>;
  fuelEfficiencyComparison: Array<{
    month: string;
    vehicles: Array<{ vehicleId: string; vehicleName: string; efficiency: number }>;
  }>;
  units: { distanceUnit: string; volumeUnit: string; chargeUnit: string };
}

export interface FinancingData {
  summary: {
    totalMonthlyPayments: number;
    remainingBalance: number;
    // One month's interest on each loan's CURRENT balance, summed across loans. Renamed from the
    // misleading `interestPaidYtd` (bug #9): it is neither year-to-date nor actually paid — it's a
    // forward estimate of this month's interest. True YTD-paid would need a payment-history sum.
    monthlyInterestEstimate: number;
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
    // This month's interest on the current balance (see summary note) — renamed from `interestPaid`.
    monthlyInterestEstimate: number;
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
  totalDistance: number;
  costPerDistance: number | null;
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
  fuelEfficiencyAndCost: Array<{ month: string; efficiency: number | null; cost: number }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
}

export interface YearEndData {
  year: number;
  totalSpent: number;
  categoryBreakdown: Array<{ category: string; amount: number; percentage: number }>;
  efficiencyTrend: Array<{ month: string; efficiency: number }>;
  biggestExpense: { description: string; amount: number; date: string } | null;
  previousYearComparison: { totalSpent: number; percentageChange: number } | null;
  vehicleCount: number;
  totalDistance: number;
  avgEfficiency: number | null;
  costPerDistance: number | null;
  units: { distanceUnit: string; volumeUnit: string; chargeUnit: string };
}

interface DateRange {
  start: number;
  end: number;
}

export type { DateRange };

export interface AnalyticsSummaryData {
  quickStats: QuickStatsData;
  fuelStats: FuelStatsData;
  fuelAdvanced: FuelAdvancedData;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AnalyticsRepository {
  private vehicleNameCache = new Map<string, { data: Map<string, string>; timestamp: number }>();
  private static readonly VEHICLE_NAME_CACHE_TTL = 5_000; // 5 seconds
  private static readonly VEHICLE_NAME_CACHE_MAX_SIZE = 100;

  constructor(private db: AppDatabase) {}

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

  /**
   * Resolve a single fetched row's stored unit preferences to a usable value, falling back to the
   * defaults when the row is absent OR its stored prefs don't parse (C129 dedup of the byte-identical
   * tail shared by getUserUnits + getVehicleUnits). NOTE: this is the FALLBACK-on-bad-prefs semantics;
   * getAllVehicleUnits deliberately does NOT use it — it THROWS on invalid prefs, so folding it in here
   * would silently swallow a real data error (the C90 inverted-semantics exclusion).
   */
  private resolveUnitsOrDefault(row: { unitPreferences: unknown } | undefined): UnitPreferences {
    if (!row) return { ...DEFAULT_UNIT_PREFERENCES };
    const parsed = parseUnitPreferences(row.unitPreferences);
    return parsed ?? { ...DEFAULT_UNIT_PREFERENCES };
  }

  /** Read the user's global unit preferences from user_preferences. */
  async getUserUnits(userId: string): Promise<UnitPreferences> {
    try {
      const rows = await this.db
        .select({ unitPreferences: userPreferences.unitPreferences })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);

      return this.resolveUnitsOrDefault(rows[0]);
    } catch (error) {
      throw new DatabaseError('Failed to read user unit preferences', error);
    }
  }

  /** Read a vehicle's unit preferences. */
  async getVehicleUnits(vehicleId: string): Promise<UnitPreferences> {
    try {
      const rows = await this.db
        .select({ unitPreferences: vehicles.unitPreferences })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .limit(1);

      return this.resolveUnitsOrDefault(rows[0]);
    } catch (error) {
      throw new DatabaseError('Failed to read vehicle unit preferences', error);
    }
  }

  /** Read all vehicle unit preferences for a user, keyed by vehicleId. */
  async getAllVehicleUnits(userId: string): Promise<Map<string, UnitPreferences>> {
    try {
      const rows = await this.db
        .select({ id: vehicles.id, unitPreferences: vehicles.unitPreferences })
        .from(vehicles)
        .where(eq(vehicles.userId, userId));

      const result = new Map<string, UnitPreferences>();
      for (const row of rows) {
        const parsed = parseUnitPreferences(row.unitPreferences);
        if (!parsed) {
          throw new ValidationError(`Vehicle ${row.id} has invalid unit preferences`);
        }
        result.set(row.id, parsed);
      }
      return result;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new DatabaseError('Failed to read vehicle unit preferences', error);
    }
  }

  /**
   * Check whether all vehicles in the map share the same units as the target.
   * When true, no conversion is needed — raw values can be aggregated directly.
   */
  private allVehiclesMatchUnits(
    vehicleUnitsMap: Map<string, UnitPreferences>,
    target: UnitPreferences
  ): boolean {
    for (const units of vehicleUnitsMap.values()) {
      if (
        units.distanceUnit !== target.distanceUnit ||
        units.volumeUnit !== target.volumeUnit ||
        units.chargeUnit !== target.chargeUnit
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Compute per-vehicle efficiency values, converting each to the target unit system.
   * Iterates fuel rows grouped by vehicle, computes efficiency from consecutive pairs,
   * and converts to the target units when skipConversion is false.
   */
  private computeConvertedEfficiencyValues(
    fuelRows: FuelExpenseRow[],
    vehicleUnitsMap: Map<string, UnitPreferences>,
    targetUnits: UnitPreferences,
    skipConversion: boolean
  ): number[] {
    const values: number[] = [];
    for (const [vehicleId, rows] of groupByVehicle(fuelRows)) {
      const vUnits = vehicleUnitsMap.get(vehicleId) ?? { ...DEFAULT_UNIT_PREFERENCES };
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) continue;
        const point = computeEfficiencyPoint(current, previous);
        if (!point) continue;

        values.push(
          skipConversion
            ? point.efficiency
            : convertEfficiency(
                point.efficiency,
                vUnits.distanceUnit,
                vUnits.volumeUnit,
                targetUnits.distanceUnit,
                targetUnits.volumeUnit
              )
        );
      }
    }
    return values;
  }

  /**
   * Mean of the (already unit-converted) per-pair efficiency values, or null when there are none.
   * The ONE source of truth for the `values.length > 0 ? sum/len : null` averaging the three analytics
   * readers (getQuickStats / getYearEnd / getSummary) computed byte-identically off
   * computeConvertedEfficiencyValues — so a future change to the averaging (outlier trim, weighting)
   * lands once, and the empty→null guard (a common div-by-zero vector) lives in one place.
   */
  private computeAverageEfficiency(values: number[]): number | null {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  /**
   * Compute per-vehicle total distance, converting each to the target unit system.
   * Groups mileage readings by vehicle, computes max-min range, and converts.
   */
  private computeConvertedTotalDistance(
    fuelRows: FuelExpenseRow[],
    vehicleUnitsMap: Map<string, UnitPreferences>,
    targetUnits: UnitPreferences,
    skipConversion: boolean
  ): number {
    const vehicleMileages = new Map<string, number[]>();
    for (const row of fuelRows) {
      if (row.mileage == null) continue;
      const arr = vehicleMileages.get(row.vehicleId) ?? [];
      arr.push(row.mileage);
      vehicleMileages.set(row.vehicleId, arr);
    }
    let total = 0;
    for (const [vId, mileages] of vehicleMileages) {
      if (mileages.length < 2) continue;
      let distance = maxOf(mileages) - minOf(mileages);
      if (!skipConversion && distance > 0) {
        const vUnits = vehicleUnitsMap.get(vId) ?? { ...DEFAULT_UNIT_PREFERENCES };
        distance = convertDistance(distance, vUnits.distanceUnit, targetUnits.distanceUnit);
      }
      total += distance;
    }
    return total;
  }

  /**
   * Build monthly MPG trend with per-vehicle unit conversion (max 12 entries).
   * Same logic as buildEfficiencyTrend but converts each vehicle's efficiency values first.
   */
  private buildConvertedEfficiencyTrend(
    fuelRows: FuelExpenseRow[],
    vehicleUnitsMap: Map<string, UnitPreferences>,
    targetUnits: UnitPreferences,
    skipConversion: boolean
  ): Array<{ month: string; efficiency: number }> {
    const monthMap = new Map<string, { effSum: number; effCount: number }>();

    for (const [vehicleId, rows] of groupByVehicle(fuelRows)) {
      const vUnits = vehicleUnitsMap.get(vehicleId) ?? { ...DEFAULT_UNIT_PREFERENCES };
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) continue;
        const point = computeEfficiencyPoint(current, previous);
        if (!point) continue;

        const converted = skipConversion
          ? point.efficiency
          : convertEfficiency(
              point.efficiency,
              vUnits.distanceUnit,
              vUnits.volumeUnit,
              targetUnits.distanceUnit,
              targetUnits.volumeUnit
            );

        const month = toMonthKey(new Date(point.date));
        const entry = monthMap.get(month) ?? { effSum: 0, effCount: 0 };
        entry.effSum += converted;
        entry.effCount++;
        monthMap.set(month, entry);
      }
    }

    return (
      Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        // Most RECENT 12 months (see buildMonthlyConsumption). Today this is only reached via
        // getYearEnd (range capped to ≤12 buckets, so slice(0,12) was benign), but fixing the
        // latent copy keeps the whole month-window convention consistent.
        .slice(-12)
        .map(([month, data]) => ({
          month,
          efficiency: data.effCount > 0 ? data.effSum / data.effCount : 0,
        }))
    );
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
    const conditions = [eq(expenses.userId, userId), eq(expenses.category, 'fuel')];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    if (range) {
      conditions.push(gte(expenses.date, new Date(range.start * 1000)));
      conditions.push(lt(expenses.date, new Date(range.end * 1000)));
    }
    return this.db
      .select({
        date: expenses.date,
        mileage: expenses.mileage,
        volume: expenses.volume,
        fuelType: expenses.fuelType,
        missedFillup: expenses.missedFillup,
        expenseAmount: expenses.expenseAmount,
        vehicleId: expenses.vehicleId,
      })
      .from(expenses)
      .where(and(...conditions))
      .orderBy(asc(expenses.date));
  }

  /** Query all expenses for a user, optionally filtered by vehicle and date range. */
  private async queryAllExpenses(
    userId: string,
    range?: DateRange,
    vehicleId?: string
  ): Promise<GeneralExpenseRow[]> {
    const conditions = [eq(expenses.userId, userId)];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    if (range) {
      conditions.push(gte(expenses.date, new Date(range.start * 1000)));
      conditions.push(lt(expenses.date, new Date(range.end * 1000)));
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
        volume: expenses.volume,
        missedFillup: expenses.missedFillup,
      })
      .from(expenses)
      .where(and(...conditions))
      .orderBy(asc(expenses.date));
  }

  private async queryTotalSpending(userId: string, year: number): Promise<number> {
    const { start: yearStart, end: yearEnd } = calendarYearRange(year);
    const result = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${expenses.expenseAmount}), 0)` })
      .from(expenses)
      .where(
        and(eq(expenses.userId, userId), gte(expenses.date, yearStart), lt(expenses.date, yearEnd))
      );
    return result[0]?.total ?? 0;
  }
  private async queryFuelAggregates(
    userId: string,
    range: DateRange,
    vehicleId?: string
  ): Promise<{ count: number; totalGallons: number }> {
    const conditions = [
      eq(expenses.userId, userId),
      eq(expenses.category, 'fuel'),
      gte(expenses.date, new Date(range.start * 1000)),
      lt(expenses.date, new Date(range.end * 1000)),
    ];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    // COUNT only volume-bearing rows so the previous-year fillup count matches the
    // in-memory isFillup predicate in buildFuelStatsFromData (a split fuel sibling has
    // volume=null and is not a fillup — bug #18). The gallons SUM is unaffected (null
    // volume contributes nothing) but is kept explicit for symmetry.
    const result = await this.db
      .select({
        count: sql<number>`COUNT(CASE WHEN ${expenses.volume} > 0 THEN 1 END)`,
        totalGallons: sql<number>`COALESCE(SUM(${expenses.volume}), 0)`,
      })
      .from(expenses)
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
      const d = toDate(row.date);
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
  private async buildFinancingVehicleDetails(
    financingRows: Array<{
      id: string;
      vehicleId: string;
      isActive: boolean;
      financingType: string;
      paymentAmount: number;
      originalAmount: number;
      apr: number | null;
      termMonths: number;
      startDate: Date | null;
    }>,
    vehicleNameMap: Map<string, string>
  ): Promise<{
    vehicleDetails: FinancingData['vehicleDetails'];
    totalMonthlyPayments: number;
    remainingBalance: number;
    loanCount: number;
    leaseCount: number;
    activeIds: Set<string>;
  }> {
    const { financingRepository } = await import('../financing/repository');
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
      const computedBalance = await financingRepository.computeBalance(fin.id);
      remainingBalance += computedBalance;
      if (fin.financingType === 'loan') loanCount++;
      if (fin.financingType === 'lease') leaseCount++;
      vehicleDetails.push(this.buildSingleFinancingDetail(fin, vehicleNameMap, computedBalance));
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
          monthlyInterestEstimate: 0,
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
      originalAmount: number;
      apr: number | null;
      termMonths: number;
      startDate: Date | null;
    },
    vehicleNameMap: Map<string, string>,
    computedBalance: number
  ): FinancingData['vehicleDetails'][number] {
    const monthlyInterestEstimate =
      fin.financingType === 'loan' && fin.apr ? (computedBalance * (fin.apr / 100)) / 12 : 0;
    // startDate is `Date | null` in this builder's local type but `.notNull()` in the schema, so it's
    // never actually null at runtime. The `?? 0` preserves the prior `new Date(<null-cast>)`=epoch
    // behavior on the impossible-null path EXACTLY, while satisfying toDate's non-null param.
    const startDate = toDate(fin.startDate ?? 0);
    const now = new Date();
    const monthsElapsed = Math.max(0, monthsBetween(startDate, now));
    return {
      vehicleId: fin.vehicleId,
      vehicleName: vehicleNameMap.get(fin.vehicleId) ?? 'Unknown',
      financingType: fin.financingType as 'loan' | 'lease' | 'own',
      monthlyPayment: fin.paymentAmount,
      remainingBalance: computedBalance,
      apr: fin.apr,
      monthlyInterestEstimate,
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
  private async buildLoanBreakdown(
    financingRows: Array<{
      id: string;
      isActive: boolean;
      financingType: string;
      apr: number | null;
      originalAmount: number;
      paymentAmount: number;
    }>
  ): Promise<FinancingData['loanBreakdown']> {
    const activeLoans = financingRows.filter(
      (f) => f.isActive && f.financingType === 'loan' && f.apr
    );
    if (activeLoans.length === 0) return [];

    const { financingRepository } = await import('../financing/repository');
    const now = new Date();

    // Resolve each loan's current balance, then hand the pure amortization helper the inputs +
    // the 12 month-key labels. The helper walks each balance down by its principal each month
    // (bug #10 — balances were previously read but never decremented, so all 12 months were equal).
    const loans = await Promise.all(
      activeLoans.map(async (loan) => ({
        balance: await financingRepository.computeBalance(loan.id),
        apr: loan.apr ?? 0,
        paymentAmount: loan.paymentAmount,
      }))
    );
    const monthKeys = Array.from({ length: 12 }, (_, m) =>
      toMonthKey(new Date(now.getFullYear(), now.getMonth() + m, 1))
    );

    return buildAmortizationSchedule(loans, monthKeys);
  }

  // ---- Insurance helpers --------------------------------------------------

  /** Process active policies into vehicle details and aggregation maps using insurance_terms table. */
  private buildInsuranceDetails(
    activePolicies: Array<{ id: string; company: string }>,
    termRows: Array<{
      id: string;
      policyId: string;
      startDate: Date | null;
      endDate: Date | null;
      monthlyCost: number | null;
      totalCost: number | null;
      deductibleAmount: number | null;
      coverageDescription: string | null;
    }>,
    junctionRows: Array<{ termId: string; vehicleId: string }>,
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
      // Get the latest term for this policy
      const policyTerms = termRows.filter((t) => t.policyId === policy.id);
      const latestTerm = policyTerms.sort((a, b) => {
        // Latest term = newest endDate (descending). insuranceTerms.endDate is NOT NULL (schema), so
        // the instanceof guard is purely defensive — a null can't occur in practice (treated as epoch).
        const aEnd = a.endDate instanceof Date ? a.endDate.getTime() : 0;
        const bEnd = b.endDate instanceof Date ? b.endDate.getTime() : 0;
        if (bEnd !== aEnd) return bEnd - aEnd;
        // Deterministic tiebreak when two terms share an endDate (e.g. a mid-term correction): the
        // later-STARTING term is the more current one (#50 — without this the pick was DB-row-order
        // dependent / nondeterministic, since the term query has no ORDER BY).
        const aStart = a.startDate instanceof Date ? a.startDate.getTime() : 0;
        const bStart = b.startDate instanceof Date ? b.startDate.getTime() : 0;
        return bStart - aStart;
      })[0];
      if (!latestTerm) continue;

      // Honour both cost shapes: an explicit monthlyCost, or a lump-sum totalCost amortized
      // across the term span (bug #8 — `monthlyCost ?? 0` zeroed every totalCost-only term).
      const monthlyPremium = effectiveMonthlyPremium(latestTerm);
      const annualPremium = monthlyPremium * 12;
      // Scope the covered vehicles to the LATEST term's junctions — the same term the premium is
      // computed from (#25). Spanning EVERY term's junctions mis-distributes when coverage changed
      // across terms: if an old term covered {A,B,C} and the latest covers {A}, dividing the latest
      // premium by 3 understates A and invents a phantom premium for the dropped B,C (and inflates
      // costByCarrier.vehicleCount). Aggregate totals are unaffected (added once per policy); this
      // only fixes the per-vehicle + per-carrier DISTRIBUTION.
      const coveredVehicleIds = [
        ...new Set(junctionRows.filter((j) => j.termId === latestTerm.id).map((j) => j.vehicleId)),
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
    term: { deductibleAmount: number | null; coverageDescription: string | null }
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
        deductible: term.deductibleAmount ?? null,
        coverageType: term.coverageDescription ?? null,
      });
    }
  }

  /** Accumulate monthly premium data from a term's date range. */
  private accumulateMonthlyPremiums(
    monthlyMap: Map<string, number>,
    term: { startDate: Date | null; endDate: Date | null },
    monthlyPremium: number
  ): void {
    if (!term.startDate || !term.endDate) return;
    const start = toDate(term.startDate);
    const end = toDate(term.endDate);
    // monthKeysInRange anchors to day-1 per month, so a term starting on day 29-31 no longer
    // skips a short month (the setMonth-overshoot bug — cycle 14).
    for (const key of monthKeysInRange(start, end)) {
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + monthlyPremium);
    }
  }

  // ---- TCO helpers --------------------------------------------------------

  /** Categorize expenses into TCO cost buckets. */
  private categorizeTCOExpenses(
    rows: Array<{
      category: string;
      expenseAmount: number;
      sourceType: string | null;
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
      if (row.category === 'financial' && row.sourceType === 'financing')
        financingInterest += row.expenseAmount;
      else if (row.category === 'financial' && row.sourceType === 'insurance_term')
        insuranceCost += row.expenseAmount;
      else if (row.category === 'fuel') fuelCost += row.expenseAmount;
      else if (row.category === 'maintenance') maintenanceCost += row.expenseAmount;
      else otherCosts += row.expenseAmount;
    }
    return { financingInterest, insuranceCost, fuelCost, maintenanceCost, otherCosts };
  }

  /**
   * Assemble the TCO total from the categorized buckets, applying two accounting rules:
   *
   * - #28 (C121): purchasePrice is a one-time ACQUISITION cost — include it only in the all-time
   *   (no-`year`) total, never in a year-scoped window (whose expenses are already date-filtered).
   * - #27 (C154, Angelo-approved option c): the `financingInterest` bucket sums WHOLE financing-sourced
   *   expense rows — full loan/lease payments (principal + interest), not interest alone (computeBalance
   *   proves payments retire principal: financing/repository.ts:68). Counting both purchasePrice AND those
   *   payments double-counts the principal (a $30k car with ~$33k of payments → TCO ≈ $63k). So when
   *   purchasePrice is counted, EXCLUDE the financing-payment rows (they retire the already-counted price,
   *   a balance-transfer, not new spend). When purchasePrice is NOT counted (no price, or a year window),
   *   the financing outflow IS the cost signal for that window, so keep it.
   *
   * Returns `countedFinancingInterest` — the financing value actually included (0 when excluded) — so the
   * caller can report a bucket that matches the total (keeps the breakdown summing: Property 14 / Req 10.2).
   */
  private computeTCOTotal(
    costs: {
      financingInterest: number;
      insuranceCost: number;
      fuelCost: number;
      maintenanceCost: number;
      otherCosts: number;
    },
    purchasePrice: number | null,
    year?: number
  ): { totalCost: number; countedFinancingInterest: number } {
    const purchaseInTotal = year ? 0 : (purchasePrice ?? 0);
    const countedFinancingInterest = purchaseInTotal > 0 ? 0 : costs.financingInterest;
    const totalCost =
      purchaseInTotal +
      countedFinancingInterest +
      costs.insuranceCost +
      costs.fuelCost +
      costs.maintenanceCost +
      costs.otherCosts;
    return { totalCost, countedFinancingInterest };
  }

  // ---- Public API methods -------------------------------------------------

  /** Compute fuel efficiency trend from sequential fuel expenses. */
  async getFuelEfficiencyTrend(userId: string, vehicleId?: string): Promise<FuelEfficiencyPoint[]> {
    try {
      const conditions = [
        eq(vehicles.userId, userId),
        eq(expenses.category, 'fuel'),
        isNotNull(expenses.mileage),
        isNotNull(expenses.volume),
      ];
      if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
      const rows = await this.db
        .select({
          // vehicleId is REQUIRED for the fleet view (no vehicleId arg): without grouping, the
          // date-ordered multi-vehicle list would pair two DIFFERENT cars' consecutive rows and
          // subtract their odometers → a phantom efficiency point (#54). forEachVehiclePair groups
          // by vehicle first, mirroring the MPG/cost charts (computeMpgAndCostPerMile).
          vehicleId: expenses.vehicleId,
          date: expenses.date,
          mileage: expenses.mileage,
          volume: expenses.volume,
          fuelType: expenses.fuelType,
          missedFillup: expenses.missedFillup,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.vehicleId), asc(expenses.date));
      if (rows.length < 2) return [];
      const points: FuelEfficiencyPoint[] = [];
      forEachVehiclePair(rows, (current, previous) => {
        const point = computeEfficiencyPoint(current as FuelRow, previous as FuelRow);
        if (point) points.push(point);
      });
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
      const vehicleRows = await this.db
        .select({
          id: vehicles.id,
        })
        .from(vehicles)
        .where(eq(vehicles.userId, userId));

      const vehicleCount = vehicleRows.length;

      const [allExpenses, fuelRows, userUnits, vehicleUnitsMap] = await Promise.all([
        this.queryAllExpenses(userId, range),
        this.queryFuelExpenses(userId, range),
        this.getUserUnits(userId),
        this.getAllVehicleUnits(userId),
      ]);

      const ytdSpending = allExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
      const skipConversion = this.allVehiclesMatchUnits(vehicleUnitsMap, userUnits);
      const convertedEfficiencyValues = this.computeConvertedEfficiencyValues(
        fuelRows,
        vehicleUnitsMap,
        userUnits,
        skipConversion
      );
      const avgEfficiency = this.computeAverageEfficiency(convertedEfficiencyValues);

      const fleetHealthScore =
        vehicleCount > 0 ? await this.computeFleetHealthScore(vehicleRows, userId) : 0;

      return {
        vehicleCount,
        ytdSpending,
        avgEfficiency,
        fleetHealthScore,
        units: { ...userUnits },
      };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
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
    vehicleRows: Array<{ id: string }>,
    userId: string
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

    // Batch-query vehicles with active insurance coverage via insurance_terms JOIN
    const coveredVehicleIds = await this.queryCoveredVehicleIds(vehicleIds, userId);

    // Compute per-vehicle scores without individual DB calls
    let totalScore = 0;
    for (const v of vehicleRows) {
      const maint = maintenanceByVehicle.get(v.id) ?? [];
      const maintenanceRegularity = computeRegularityScore(maint);
      const mileageAdherence = computeMileageScore(maint);
      const insuranceCoverage = coveredVehicleIds.has(v.id) ? 100 : 0;
      totalScore += Math.round(
        maintenanceRegularity * 0.4 + mileageAdherence * 0.35 + insuranceCoverage * 0.25
      );
    }
    return Math.round(totalScore / vehicleRows.length);
  }

  /** Query vehicle IDs that have active insurance coverage via insurance_terms + insurance_term_vehicles JOIN. */
  private async queryCoveredVehicleIds(vehicleIds: string[], userId: string): Promise<Set<string>> {
    if (vehicleIds.length === 0) return new Set();

    // Find vehicles covered by active policies via JOIN through insurance_terms + insurance_term_vehicles
    const rows = await this.db
      .select({ vehicleId: insuranceTermVehicles.vehicleId })
      .from(insuranceTermVehicles)
      .innerJoin(insuranceTerms, eq(insuranceTermVehicles.termId, insuranceTerms.id))
      .innerJoin(insurancePolicies, eq(insuranceTerms.policyId, insurancePolicies.id))
      .where(
        and(
          inArray(insuranceTermVehicles.vehicleId, vehicleIds),
          eq(insurancePolicies.isActive, true),
          eq(insurancePolicies.userId, userId)
        )
      );

    return new Set(rows.map((r) => r.vehicleId));
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

      // Sort by vehicleId then date for functions that need consecutive same-vehicle pairs
      const fuelRowsByVehicle = sortByVehicleThenDate(fuelRows);

      return this.buildFuelStatsFromData(
        fuelRows,
        fuelRowsByVehicle,
        vehicleNameMap,
        range,
        prevYearAgg
      );
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

  /** Build fuel stats from pre-fetched data without querying the DB. */
  private buildFuelStatsFromData(
    fuelRows: FuelExpenseRow[],
    fuelRowsByVehicle: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>,
    range: DateRange,
    prevYearAgg: { count: number; totalGallons: number }
  ): FuelStatsData {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const rangeStartDate = new Date(range.start * 1000);
    const rangeEndDate = new Date(range.end * 1000);

    const toDate = (r: FuelExpenseRow) =>
      r.date instanceof Date ? r.date : new Date(r.date as unknown as number);
    // A "fillup" is a fuel PURCHASE — it carries an actual volume. A split fuel expense
    // creates one sibling row per vehicle, but only the amount is split: siblings have
    // volume=null (see ExpenseSplitService.createSiblings). Counting raw rows would inflate
    // the fillup count by (#vehicles − 1) per split fillup in the cross-fleet view (bug #18).
    // Count only volume-bearing rows — the same predicate fillupDetails already uses — so a
    // split fillup counts once and a volume-less row never counts as a fillup. The volume/
    // cost SUMS were always correct (null volume contributes 0); only the COUNTS were wrong.
    // isFillup is the shared predicate (analytics-charts.ts, C403) — one source of truth.
    const currentYearFillups = fuelRows.filter(isFillup).length;
    const previousYearFillups = prevYearAgg.count;
    // "This/Last Month" are CALENDAR months (the FE labels them so) — match BOTH month AND year.
    // fuelRows spans the whole requested range (default 'all' = multi-year), so a year-less
    // getMonth() match folded every prior year's same-month fillups into "This Month" (#86,
    // NORTH_STAR #2 correct-for-everyone). "Last Month" is the calendar month before now, which
    // rolls into the previous YEAR when now is January.
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const inCurrentMonth = (r: FuelExpenseRow) => {
      const d = toDate(r);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    };
    const inPrevMonth = (r: FuelExpenseRow) => {
      const d = toDate(r);
      return d.getMonth() === prevMonth && d.getFullYear() === prevMonthYear;
    };
    const currentMonthFillups = fuelRows.filter((r) => isFillup(r) && inCurrentMonth(r)).length;
    const prevMonthFillups = fuelRows.filter((r) => isFillup(r) && inPrevMonth(r)).length;

    const sumGallons = (rows: FuelExpenseRow[]) => rows.reduce((s, r) => s + (r.volume ?? 0), 0);
    const currentYearGallons = sumGallons(fuelRows);
    const previousYearGallons = prevYearAgg.totalGallons;
    const currentMonthGallons = sumGallons(fuelRows.filter(inCurrentMonth));
    const prevMonthGallons = sumGallons(fuelRows.filter(inPrevMonth));

    const { mpgValues, costPerMileValues } = computeMpgAndCostPerMile(fuelRowsByVehicle);
    const fuelConsumption = computeFuelConsumptionMetrics(mpgValues);

    const volumes = fuelRows
      .filter((r) => r.volume != null && r.volume > 0)
      .map((r) => r.volume as number);
    const fillupDetails = {
      avgVolume: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
      minVolume: volumes.length > 0 ? minOf(volumes) : null,
      maxVolume: volumes.length > 0 ? maxOf(volumes) : null,
    };

    const averageCost = computeAverageCosts(
      fuelRows,
      costPerMileValues,
      rangeStartDate,
      rangeEndDate,
      now
    );

    // Distance must be summed PER VEHICLE (max-min within each car), then totaled. Pooling
    // every vehicle's odometer readings into one max-min gives garbage for a multi-vehicle
    // user (e.g. a car at 12k mi and one at 95k mi would report ~83k). Delegate to the shared
    // computeConvertedTotalDistance (C392) with skipConversion=true — this summary path is
    // single-unit so it doesn't convert; the unit args are ignored under skipConversion. ONE
    // source of truth for the per-vehicle group→max-min→sum, in lockstep with the year-end path.
    const totalDistance = this.computeConvertedTotalDistance(
      fuelRows,
      new Map(),
      DEFAULT_UNIT_PREFERENCES,
      true
    );
    const daysSoFar = Math.max(
      1,
      Math.ceil(
        (Math.min(now.getTime(), rangeEndDate.getTime()) - rangeStartDate.getTime()) / 86400000
      )
    );
    const distance = {
      totalDistance,
      avgPerDay: totalDistance > 0 ? totalDistance / daysSoFar : null,
      avgPerMonth:
        totalDistance > 0 ? totalDistance / Math.max(1, Math.ceil(daysSoFar / 30)) : null,
    };

    return {
      fillups: {
        currentYear: currentYearFillups,
        previousYear: previousYearFillups,
        currentMonth: currentMonthFillups,
        previousMonth: prevMonthFillups,
      },
      volume: {
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
      costPerDistance: buildCostPerDistanceChart(fuelRowsByVehicle, vehicleNameMap),
    };
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

      // Sort by vehicleId then date for functions that need consecutive same-vehicle pairs
      const fuelRowsByVehicle = sortByVehicleThenDate(fuelRows);

      return this.buildFuelAdvancedFromData(
        fuelRows,
        fuelRowsByVehicle,
        allExpenses,
        vehicleNameMap
      );
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

  /** Build fuel advanced analytics from pre-fetched data without querying the DB. */
  private buildFuelAdvancedFromData(
    fuelRows: FuelExpenseRow[],
    fuelRowsByVehicle: FuelExpenseRow[],
    allExpenses: GeneralExpenseRow[],
    vehicleNameMap: Map<string, string>
  ): FuelAdvancedData {
    const maintenanceRows = allExpenses.filter((e) => e.category === 'maintenance');
    return {
      maintenanceTimeline: buildMaintenanceTimeline(maintenanceRows, new Date()),
      seasonalEfficiency: buildSeasonalEfficiency(fuelRowsByVehicle),
      vehicleRadar: buildVehicleRadar(allExpenses, fuelRowsByVehicle, vehicleNameMap),
      dayOfWeekPatterns: buildDayOfWeekPatterns(fuelRows),
      monthlyCostHeatmap: buildMonthlyCostHeatmap(allExpenses),
      fillupIntervals: buildFillupIntervals(fuelRows),
    };
  }

  /** Compute cross-vehicle analytics: trends, category breakdown, comparisons. */
  async getCrossVehicle(userId: string, range: DateRange): Promise<CrossVehicleData> {
    try {
      const [vehicleNameMap, allExpenses, fuelRows, userUnits, vehicleUnitsMap] = await Promise.all(
        [
          this.queryVehicleNameMap(userId),
          this.queryAllExpenses(userId, range),
          this.queryFuelExpenses(userId, range),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]
      );

      const skipConversion = this.allVehiclesMatchUnits(vehicleUnitsMap, userUnits);

      // Accumulate per-vehicle cost and mileage data
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

      // Convert per-vehicle distance to user's global units before computing costPerDistance
      const vehicleCostComparison = [...vehicleNameMap.entries()].map(([vId, vName]) => {
        const data = vehicleCosts.get(vId);
        const totalCost = data?.total ?? 0;
        let totalDist =
          data && data.maxMileage > 0 && data.minMileage < Number.POSITIVE_INFINITY
            ? data.maxMileage - data.minMileage
            : 0;

        if (!skipConversion && totalDist > 0) {
          const vUnits = vehicleUnitsMap.get(vId) ?? { ...DEFAULT_UNIT_PREFERENCES };
          totalDist = convertDistance(totalDist, vUnits.distanceUnit, userUnits.distanceUnit);
        }

        return {
          vehicleId: vId,
          vehicleName: vName,
          totalCost,
          costPerDistance: totalDist > 0 ? totalCost / totalDist : null,
        };
      });

      // Build fuel efficiency comparison with per-vehicle conversion
      let fuelEfficiencyComparison: CrossVehicleData['fuelEfficiencyComparison'];
      if (skipConversion) {
        fuelEfficiencyComparison = buildFuelEfficiencyComparison(fuelRows, vehicleNameMap);
      } else {
        fuelEfficiencyComparison = this.buildConvertedFuelEfficiencyComparison(
          fuelRows,
          vehicleNameMap,
          vehicleUnitsMap,
          userUnits
        );
      }

      return {
        monthlyExpenseTrends: buildMonthlyExpenseTrends(allExpenses),
        expenseByCategory: buildExpenseByCategory(allExpenses),
        vehicleCostComparison,
        fuelEfficiencyComparison,
        units: { ...userUnits },
      };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute cross-vehicle analytics', {
        userId,
        range,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute cross-vehicle analytics', error);
    }
  }

  /**
   * Build fuel efficiency comparison with per-vehicle unit conversion.
   * Same logic as buildFuelEfficiencyComparison but converts each vehicle's
   * efficiency values to the user's global units before aggregation.
   */
  private buildConvertedFuelEfficiencyComparison(
    fuelRows: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>,
    vehicleUnitsMap: Map<string, UnitPreferences>,
    userUnits: UnitPreferences
  ): CrossVehicleData['fuelEfficiencyComparison'] {
    const byVehicle = groupByVehicle(fuelRows);

    // Compute monthly efficiency per vehicle, converting to user's global units
    const monthVehicleEff = new Map<string, Map<string, { sum: number; count: number }>>();
    for (const [vId, rows] of byVehicle) {
      const vUnits = vehicleUnitsMap.get(vId) ?? { ...DEFAULT_UNIT_PREFERENCES };
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) continue;
        const point = computeEfficiencyPoint(current, previous);
        if (!point) continue;

        const converted = convertEfficiency(
          point.efficiency,
          vUnits.distanceUnit,
          vUnits.volumeUnit,
          userUnits.distanceUnit,
          userUnits.volumeUnit
        );

        const month = toMonthKey(new Date(point.date));
        if (!monthVehicleEff.has(month)) monthVehicleEff.set(month, new Map());
        const vehicleMap = monthVehicleEff.get(month) as Map<
          string,
          { sum: number; count: number }
        >;
        const entry = vehicleMap.get(vId) ?? { sum: 0, count: 0 };
        entry.sum += converted;
        entry.count++;
        vehicleMap.set(vId, entry);
      }
    }

    return Array.from(monthVehicleEff.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-24)
      .map(([month, vehicleMap]) => ({
        month,
        vehicles: Array.from(vehicleMap.entries()).map(([vId, data]) => ({
          vehicleId: vId,
          vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
          efficiency: data.count > 0 ? data.sum / data.count : 0,
        })),
      }));
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
            monthlyInterestEstimate: 0,
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
      } = await this.buildFinancingVehicleDetails(financingRows, vehicleNameMap);

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
          monthlyInterestEstimate: vehicleDetails.reduce(
            (s, d) => s + d.monthlyInterestEstimate,
            0
          ),
          activeCount: activeIds.size,
          loanCount,
          leaseCount,
        },
        vehicleDetails,
        monthlyTimeline,
        typeDistribution,
        loanBreakdown: await this.buildLoanBreakdown(financingRows),
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
      const emptyResult: InsuranceData = {
        summary: { totalMonthlyPremiums: 0, totalAnnualPremiums: 0, activePoliciesCount: 0 },
        vehicleDetails: [],
        monthlyPremiumTrend: [],
        costByCarrier: [],
      };

      // Query policies directly by userId
      const policyRows = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.userId, userId));
      if (policyRows.length === 0) return emptyResult;

      const policyIds = policyRows.map((p) => p.id);

      // Query terms for all policies
      const termRows =
        policyIds.length > 0
          ? await this.db
              .select({
                id: insuranceTerms.id,
                policyId: insuranceTerms.policyId,
                startDate: insuranceTerms.startDate,
                endDate: insuranceTerms.endDate,
                monthlyCost: insuranceTerms.monthlyCost,
                totalCost: insuranceTerms.totalCost,
                deductibleAmount: insuranceTerms.deductibleAmount,
                coverageDescription: insuranceTerms.coverageDescription,
              })
              .from(insuranceTerms)
              .where(inArray(insuranceTerms.policyId, policyIds))
          : [];

      const termIds = termRows.map((t) => t.id);
      const junctionRows =
        termIds.length > 0
          ? await this.db
              .select({
                termId: insuranceTermVehicles.termId,
                vehicleId: insuranceTermVehicles.vehicleId,
              })
              .from(insuranceTermVehicles)
              .where(inArray(insuranceTermVehicles.termId, termIds))
          : [];

      const activePolicies = policyRows.filter((p) => p.isActive);

      const { vehicleDetails, totalMonthlyPremiums, totalAnnualPremiums, carrierMap, monthlyMap } =
        this.buildInsuranceDetails(activePolicies, termRows, junctionRows, vehicleNameMap);

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
      const [vehicleNameMap, maintenanceRows] = await Promise.all([
        this.queryVehicleNameMap(userId, vehicleId),
        this.db
          .select({ date: expenses.date, mileage: expenses.mileage })
          .from(expenses)
          .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, 'maintenance')))
          .orderBy(asc(expenses.date)),
      ]);

      const vehicleName = vehicleNameMap.get(vehicleId) ?? 'Unknown';

      // Derive active insurance coverage via JOIN through insurance_terms + insurance_term_vehicles
      const coveredVehicleIds = await this.queryCoveredVehicleIds([vehicleId], userId);
      const insuranceCoverage = coveredVehicleIds.has(vehicleId) ? 100 : 0;

      const maintenanceRegularity = computeRegularityScore(maintenanceRows);
      const mileageIntervalAdherence = computeMileageScore(maintenanceRows);
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
        const { start: yearStart, end: yearEnd } = calendarYearRange(year);
        conditions.push(gte(expenses.date, yearStart));
        conditions.push(lt(expenses.date, yearEnd));
      }
      const detailedExpenses = await this.db
        .select({
          category: expenses.category,
          expenseAmount: expenses.expenseAmount,
          date: expenses.date,
          sourceType: expenses.sourceType,
          mileage: expenses.mileage,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.date));

      const costs = this.categorizeTCOExpenses(detailedExpenses);
      const { totalCost, countedFinancingInterest } = this.computeTCOTotal(
        costs,
        purchasePrice,
        year
      );

      const now = new Date();
      const ownershipStart =
        purchaseDate instanceof Date
          ? purchaseDate
          : purchaseDate
            ? new Date(purchaseDate as unknown as number)
            : now;
      // costPerMonth must divide the (windowed) total by a matching span. All-time → purchase→now.
      // Year-scoped → the months of THAT year the vehicle was owned (≤12), so a year-filtered
      // numerator isn't divided by a full-ownership denominator (#28). Both clamp to ≥1.
      const ownershipMonths = year
        ? Math.max(1, monthsOwnedInYear(ownershipStart, now, year))
        : Math.max(1, monthsBetween(ownershipStart, now));
      const mileages = detailedExpenses
        .filter((r) => r.mileage != null)
        .map((r) => r.mileage as number);
      const totalDistance = mileages.length >= 2 ? maxOf(mileages) - minOf(mileages) : 0;

      return {
        vehicleId,
        vehicleName,
        purchasePrice,
        ...costs,
        // Override the raw bucket with the COUNTED value (0 when excluded under #27 option c) so the
        // returned financingInterest matches what the total includes — keeps the breakdown summing.
        financingInterest: countedFinancingInterest,
        totalCost,
        ownershipMonths,
        totalDistance,
        costPerDistance: totalDistance > 0 ? totalCost / totalDistance : null,
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
      const { start: yearStart, end: yearEnd } = calendarYearRange(year);
      const yearRange: DateRange = {
        start: Math.floor(yearStart.getTime() / 1000),
        end: Math.floor(yearEnd.getTime() / 1000),
      };
      const [vehicleNameMap, allExpenses, fuelRows, prevTotalSpent, userUnits, vehicleUnitsMap] =
        await Promise.all([
          this.queryVehicleNameMap(userId),
          this.queryAllExpenses(userId, yearRange),
          this.queryFuelExpenses(userId, yearRange),
          this.queryTotalSpending(userId, year - 1),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]);

      const totalSpent = allExpenses.reduce((s, e) => s + e.expenseAmount, 0);
      const skipConversion = this.allVehiclesMatchUnits(vehicleUnitsMap, userUnits);

      const totalDistance = this.computeConvertedTotalDistance(
        fuelRows,
        vehicleUnitsMap,
        userUnits,
        skipConversion
      );

      const convertedEfficiencyValues = this.computeConvertedEfficiencyValues(
        fuelRows,
        vehicleUnitsMap,
        userUnits,
        skipConversion
      );
      const avgEfficiency = this.computeAverageEfficiency(convertedEfficiencyValues);

      const efficiencyTrend = this.buildConvertedEfficiencyTrend(
        fuelRows,
        vehicleUnitsMap,
        userUnits,
        skipConversion
      );

      return {
        year,
        totalSpent,
        categoryBreakdown: buildExpenseByCategory(allExpenses),
        efficiencyTrend,
        biggestExpense: findBiggestExpense(allExpenses),
        previousYearComparison: computePreviousYearComparison(totalSpent, prevTotalSpent),
        vehicleCount: vehicleNameMap.size,
        totalDistance,
        avgEfficiency,
        costPerDistance: totalDistance > 0 ? totalSpent / totalDistance : null,
        units: { ...userUnits },
      };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute year-end summary', {
        userId,
        year,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute year-end summary', error);
    }
  }

  async getSummary(userId: string, range: DateRange): Promise<AnalyticsSummaryData> {
    try {
      const prevRange: DateRange = {
        start: range.start - (range.end - range.start),
        end: range.start,
      };

      const [
        vehicleNameMap,
        vehicleRows,
        allExpenses,
        fuelRows,
        prevYearAgg,
        userUnits,
        vehicleUnitsMap,
      ] = await Promise.all([
        this.queryVehicleNameMap(userId),
        this.db
          .select({
            id: vehicles.id,
          })
          .from(vehicles)
          .where(eq(vehicles.userId, userId)),
        this.queryAllExpenses(userId, range),
        this.queryFuelExpenses(userId, range),
        this.queryFuelAggregates(userId, prevRange),
        this.getUserUnits(userId),
        this.getAllVehicleUnits(userId),
      ]);

      const fuelRowsByVehicle = sortByVehicleThenDate(fuelRows);

      // Build quickStats with per-vehicle unit conversion
      const skipConversion = this.allVehiclesMatchUnits(vehicleUnitsMap, userUnits);
      const convertedEfficiencyValues = this.computeConvertedEfficiencyValues(
        fuelRows,
        vehicleUnitsMap,
        userUnits,
        skipConversion
      );
      const avgEfficiency = this.computeAverageEfficiency(convertedEfficiencyValues);
      const ytdSpending = allExpenses.reduce((sum, e) => sum + e.expenseAmount, 0);
      const fleetHealthScore =
        vehicleRows.length > 0 ? await this.computeFleetHealthScore(vehicleRows, userId) : 0;

      const quickStats: QuickStatsData = {
        vehicleCount: vehicleRows.length,
        ytdSpending,
        avgEfficiency,
        fleetHealthScore,
        units: { ...userUnits },
      };

      const fuelStats = this.buildFuelStatsFromData(
        fuelRows,
        fuelRowsByVehicle,
        vehicleNameMap,
        range,
        prevYearAgg
      );
      const fuelAdvanced = this.buildFuelAdvancedFromData(
        fuelRows,
        fuelRowsByVehicle,
        allExpenses,
        vehicleNameMap
      );

      return { quickStats, fuelStats, fuelAdvanced };
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute analytics summary', {
        userId,
        range,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute analytics summary', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const analyticsRepository = new AnalyticsRepository(getDb());
