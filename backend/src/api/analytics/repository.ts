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
  buildExpenseByCategory,
  buildFillupCostByVehicle,
  buildFillupIntervals,
  buildFuelEfficiencyAndCost,
  buildGasPriceHistory,
  buildMaintenanceTimeline,
  buildMonthlyCostHeatmap,
  buildMonthlyExpenseTrends,
  buildTCOMonthlyTrend,
  buildVehicleExpenseBreakdown,
  buildVehicleMaintenanceCosts,
  buildVehicleRadar,
  computeAverageCosts,
  computeFuelConsumptionMetrics,
  computeMileageScore,
  computeMpgAndCostPerMile,
  computePreviousYearComparison,
  computeRegularityScore,
  DAY_NAMES,
  effectiveMonthlyPremium,
  type FuelEfficiencyPoint,
  type FuelExpenseRow,
  type FuelRow,
  findBiggestExpense,
  forEachVehiclePair,
  type GeneralExpenseRow,
  gasEfficiencyPoint,
  groupByVehicle,
  isFillup,
  monthKeysInRange,
  normalizeDate,
  type RadarUnitConverters,
  SEASON_MAP,
  sortByVehicleThenDate,
  toMonthKey,
} from '../../utils/analytics-charts';
import { maxOf, minOf } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import { convertDistance, convertEfficiency, convertVolume } from '../../utils/unit-conversions';
import { FinancingRepository } from '../financing/repository';

export type { FuelEfficiencyPoint } from '../../utils/analytics-charts';

/**
 * Calendar months of `year` the vehicle was owned, inclusive of both endpoint months; 0 outside ownership.
 * `now` is injected rather than read from the clock so the function stays pure.
 */
export function monthsOwnedInYear(ownershipStart: Date, now: Date, year: number): number {
  const yearStartMonth = ownershipStart.getFullYear() < year ? 0 : ownershipStart.getMonth();
  const yearEndMonth = now.getFullYear() > year ? 11 : now.getMonth();
  if (ownershipStart.getFullYear() > year || now.getFullYear() < year) return 0;
  return Math.max(0, yearEndMonth - yearStartMonth + 1);
}

/** Signed whole calendar months from `from` to `to`. Callers apply their own clamp. */
export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/** Some builder inputs arrive as raw timestamps rather than Dates, so coerce defensively. */
export function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function calendarYearRange(year: number): { start: Date; end: Date } {
  return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
}

/**
 * Converts one vehicle's value into the user's units. Every fleet-pooled figure goes through one,
 * so a mixed mi/km or gal/L fleet never sums unlike units.
 */
interface FleetUnitConverter extends RadarUnitConverters {
  volume: (value: number, vehicleId: string) => number;
}

const identity = (value: number) => value;
const IDENTITY_CONVERTER: FleetUnitConverter = {
  efficiency: identity,
  distance: identity,
  volume: identity,
};

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
    // Forward estimate of one month's interest on current balances, not interest actually paid.
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

export class AnalyticsRepository {
  private vehicleNameCache = new Map<string, { data: Map<string, string>; timestamp: number }>();
  private static readonly VEHICLE_NAME_CACHE_TTL = 5_000;
  private static readonly VEHICLE_NAME_CACHE_MAX_SIZE = 100;

  constructor(private db: AppDatabase) {}

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
   * Falls back to defaults on a missing or unparseable row. getAllVehicleUnits must not reuse this:
   * it throws on invalid prefs so that data errors surface instead of being masked.
   */
  private resolveUnitsOrDefault(row: { unitPreferences: unknown } | undefined): UnitPreferences {
    if (!row) return { ...DEFAULT_UNIT_PREFERENCES };
    const parsed = parseUnitPreferences(row.unitPreferences);
    return parsed ?? { ...DEFAULT_UNIT_PREFERENCES };
  }

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

  /** True when every vehicle already uses the target units, so no conversion is needed. */
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

  /** Falls back to default units so callers never read unit fields off undefined. */
  private vehicleUnitsFor(
    vehicleUnitsMap: Map<string, UnitPreferences>,
    vehicleId: string
  ): UnitPreferences {
    return vehicleUnitsMap.get(vehicleId) ?? { ...DEFAULT_UNIT_PREFERENCES };
  }

  private fleetUnitConverter(
    vehicleUnitsMap: Map<string, UnitPreferences>,
    userUnits: UnitPreferences
  ): FleetUnitConverter {
    if (this.allVehiclesMatchUnits(vehicleUnitsMap, userUnits)) return IDENTITY_CONVERTER;
    return {
      efficiency: (value, vehicleId) => {
        const v = this.vehicleUnitsFor(vehicleUnitsMap, vehicleId);
        return convertEfficiency(
          value,
          v.distanceUnit,
          v.volumeUnit,
          userUnits.distanceUnit,
          userUnits.volumeUnit
        );
      },
      distance: (value, vehicleId) => {
        const v = this.vehicleUnitsFor(vehicleUnitsMap, vehicleId);
        return convertDistance(value, v.distanceUnit, userUnits.distanceUnit);
      },
      volume: (value, vehicleId) => {
        const v = this.vehicleUnitsFor(vehicleUnitsMap, vehicleId);
        return convertVolume(value, v.volumeUnit, userUnits.volumeUnit);
      },
    };
  }

  private rowVolume(row: FuelExpenseRow, convert: FleetUnitConverter): number {
    const v = row.volume ?? 0;
    return v === 0 ? 0 : convert.volume(v, row.vehicleId);
  }

  /**
   * Gas-only efficiency pairs in the user's units. The gas gate must run before conversion:
   * a PHEV charge session stores kWh in `volume`, and converting that as mi/gal would corrupt the value.
   */
  private *gasEfficiencyPoints(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Generator<{ vehicleId: string; efficiency: number; date: string }> {
    for (const [vehicleId, rows] of groupByVehicle(fuelRows)) {
      for (let i = 1; i < rows.length; i++) {
        const current = rows[i];
        const previous = rows[i - 1];
        if (!current || !previous) continue;
        const point = gasEfficiencyPoint(current, previous);
        if (!point) continue;
        yield {
          vehicleId,
          efficiency: convert.efficiency(point.efficiency, vehicleId),
          date: point.date,
        };
      }
    }
  }

  private computeAverageEfficiency(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): number | null {
    const values = Array.from(this.gasEfficiencyPoints(fuelRows, convert), (p) => p.efficiency);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  private computeTotalDistance(fuelRows: FuelExpenseRow[], convert: FleetUnitConverter): number {
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
      const distance = maxOf(mileages) - minOf(mileages);
      if (distance > 0) total += convert.distance(distance, vId);
    }
    return total;
  }

  private buildMonthlyConsumption(
    rows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Array<{ month: string; efficiency: number; volume: number }> {
    const map = new Map<string, { effSum: number; effCount: number; volume: number }>();

    for (const row of rows) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      const key = toMonthKey(d);
      const entry = map.get(key) ?? { effSum: 0, effCount: 0, volume: 0 };
      entry.volume += this.rowVolume(row, convert);
      map.set(key, entry);
    }

    for (const { efficiency, date } of this.gasEfficiencyPoints(rows, convert)) {
      const entry = map.get(toMonthKey(new Date(date)));
      if (entry) {
        entry.effSum += efficiency;
        entry.effCount++;
      }
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, data]) => ({
        month,
        efficiency: data.effCount > 0 ? data.effSum / data.effCount : 0,
        volume: data.volume,
      }));
  }

  private buildSeasonalEfficiency(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Array<{ season: string; avgEfficiency: number; fillupCount: number }> {
    const seasonData = new Map<string, { effSum: number; effCount: number; fillupCount: number }>();

    // Split fuel siblings carry no volume and are not fillups, so they must not inflate the count.
    for (const row of fuelRows) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      if (!isFillup(row)) continue;
      const season = SEASON_MAP[d.getMonth()] ?? 'Winter';
      const entry = seasonData.get(season) ?? { effSum: 0, effCount: 0, fillupCount: 0 };
      entry.fillupCount++;
      seasonData.set(season, entry);
    }

    for (const { efficiency, date } of this.gasEfficiencyPoints(fuelRows, convert)) {
      const season = SEASON_MAP[new Date(date).getMonth()] ?? 'Winter';
      const entry = seasonData.get(season);
      if (entry) {
        entry.effSum += efficiency;
        entry.effCount++;
      }
    }

    return ['Winter', 'Spring', 'Summer', 'Fall'].map((season) => {
      const data = seasonData.get(season);
      return {
        season,
        avgEfficiency: data && data.effCount > 0 ? data.effSum / data.effCount : 0,
        fillupCount: data?.fillupCount ?? 0,
      };
    });
  }

  private buildDayOfWeekPatterns(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Array<{ day: string; fillupCount: number; avgCost: number; avgVolume: number }> {
    const dayData = new Map<string, { count: number; totalCost: number; totalVolume: number }>();

    for (const row of fuelRows) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      if (!isFillup(row)) continue;
      const dayName = DAY_NAMES[d.getDay()] ?? 'Sunday';
      const entry = dayData.get(dayName) ?? { count: 0, totalCost: 0, totalVolume: 0 };
      entry.count++;
      entry.totalCost += row.expenseAmount;
      entry.totalVolume += this.rowVolume(row, convert);
      dayData.set(dayName, entry);
    }

    return [...DAY_NAMES].map((day) => {
      const data = dayData.get(day);
      return {
        day,
        fillupCount: data?.count ?? 0,
        avgCost: data && data.count > 0 ? data.totalCost / data.count : 0,
        avgVolume: data && data.count > 0 ? data.totalVolume / data.count : 0,
      };
    });
  }

  private buildEfficiencyTrend(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Array<{ month: string; efficiency: number }> {
    const monthMap = new Map<string, { effSum: number; effCount: number }>();

    for (const { efficiency, date } of this.gasEfficiencyPoints(fuelRows, convert)) {
      const month = toMonthKey(new Date(date));
      const entry = monthMap.get(month) ?? { effSum: 0, effCount: 0 };
      entry.effSum += efficiency;
      entry.effCount++;
      monthMap.set(month, entry);
    }

    return (
      Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        // Most recent 12 months, not the first 12.
        .slice(-12)
        .map(([month, data]) => ({
          month,
          efficiency: data.effCount > 0 ? data.effSum / data.effCount : 0,
        }))
    );
  }

  private buildFuelEfficiencyComparison(
    fuelRows: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>,
    convert: FleetUnitConverter
  ): CrossVehicleData['fuelEfficiencyComparison'] {
    const monthVehicleEff = new Map<string, Map<string, { sum: number; count: number }>>();
    for (const { vehicleId: vId, efficiency, date } of this.gasEfficiencyPoints(
      fuelRows,
      convert
    )) {
      const month = toMonthKey(new Date(date));
      if (!monthVehicleEff.has(month)) monthVehicleEff.set(month, new Map());
      const vehicleMap = monthVehicleEff.get(month) as Map<string, { sum: number; count: number }>;
      const entry = vehicleMap.get(vId) ?? { sum: 0, count: 0 };
      entry.sum += efficiency;
      entry.count++;
      vehicleMap.set(vId, entry);
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

  private async queryVehicleNameMap(
    userId: string,
    vehicleId?: string
  ): Promise<Map<string, string>> {
    const now = Date.now();
    const cacheKey = vehicleId ? `${userId}:${vehicleId}` : userId;

    if (vehicleId) {
      const allData = this.getCachedVehicleNames(userId, now);
      const name = allData?.get(vehicleId);
      if (name !== undefined) {
        return new Map<string, string>([[vehicleId, name]]);
      }
    }

    const cached = this.getCachedVehicleNames(cacheKey, now);
    if (cached) return cached;

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
  ): Promise<{ count: number; volumeByVehicle: Map<string, number> }> {
    const conditions = [
      eq(expenses.userId, userId),
      eq(expenses.category, 'fuel'),
      gte(expenses.date, new Date(range.start * 1000)),
      lt(expenses.date, new Date(range.end * 1000)),
    ];
    if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
    // Counts only volume-bearing rows, matching isFillup. Volume is summed per vehicle so each sum can be
    // converted to the user's volume unit before pooling.
    const rows = await this.db
      .select({
        vehicleId: expenses.vehicleId,
        count: sql<number>`COUNT(CASE WHEN ${expenses.volume} > 0 THEN 1 END)`,
        totalGallons: sql<number>`COALESCE(SUM(${expenses.volume}), 0)`,
      })
      .from(expenses)
      .where(and(...conditions))
      .groupBy(expenses.vehicleId);
    let count = 0;
    const volumeByVehicle = new Map<string, number>();
    for (const r of rows) {
      count += r.count;
      if (r.totalGallons > 0) volumeByVehicle.set(r.vehicleId, r.totalGallons);
    }
    return { count, volumeByVehicle };
  }

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

  /**
   * Batched balances for active financing rows, computed once per request so both financing builders
   * agree. An id missing from the map means no balance.
   */
  private async computeActiveBalances(
    financingRows: Array<{ id: string; isActive: boolean }>
  ): Promise<Map<string, number>> {
    return new FinancingRepository(this.db).computeBalances(
      financingRows.filter((fin) => fin.isActive).map((fin) => fin.id)
    );
  }

  private buildFinancingVehicleDetails(
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
    vehicleNameMap: Map<string, string>,
    balances: Map<string, number>
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
      const computedBalance = balances.get(fin.id) ?? 0;
      remainingBalance += computedBalance;
      if (fin.financingType === 'loan') loanCount++;
      if (fin.financingType === 'lease') leaseCount++;
      vehicleDetails.push(this.buildSingleFinancingDetail(fin, vehicleNameMap, computedBalance));
    }

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
    // startDate is non-null in the schema; the `?? 0` only satisfies the local nullable type.
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

  private buildLoanBreakdown(
    financingRows: Array<{
      id: string;
      isActive: boolean;
      financingType: string;
      apr: number | null;
      originalAmount: number;
      paymentAmount: number;
    }>,
    balances: Map<string, number>
  ): FinancingData['loanBreakdown'] {
    // Do not filter on truthy apr: a 0% loan is valid and must stay in the schedule.
    const activeLoans = financingRows.filter((f) => f.isActive && f.financingType === 'loan');
    if (activeLoans.length === 0) return [];

    const now = new Date();

    // Balances amortize month to month; holding one constant would repeat the same row twelve times.
    const loans = activeLoans.map((loan) => ({
      balance: balances.get(loan.id) ?? 0,
      apr: loan.apr ?? 0,
      paymentAmount: loan.paymentAmount,
    }));
    const monthKeys = Array.from({ length: 12 }, (_, m) =>
      toMonthKey(new Date(now.getFullYear(), now.getMonth() + m, 1))
    );

    return buildAmortizationSchedule(loans, monthKeys);
  }

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
      const policyTerms = termRows.filter((t) => t.policyId === policy.id);
      const latestTerm = policyTerms.sort((a, b) => {
        const aEnd = a.endDate instanceof Date ? a.endDate.getTime() : 0;
        const bEnd = b.endDate instanceof Date ? b.endDate.getTime() : 0;
        if (bEnd !== aEnd) return bEnd - aEnd;
        // Ties break by start date so the pick is deterministic; the term query has no ORDER BY.
        const aStart = a.startDate instanceof Date ? a.startDate.getTime() : 0;
        const bStart = b.startDate instanceof Date ? b.startDate.getTime() : 0;
        return bStart - aStart;
      })[0];
      if (!latestTerm) continue;

      // A term may be priced by monthly cost or by a lump sum over its span; both must be honored.
      const monthlyPremium = effectiveMonthlyPremium(latestTerm);
      const annualPremium = monthlyPremium * 12;
      // Covered vehicles come from the latest term only, matching the term the premium is taken from.
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

  private accumulateMonthlyPremiums(
    monthlyMap: Map<string, number>,
    term: { startDate: Date | null; endDate: Date | null },
    monthlyPremium: number
  ): void {
    if (!term.startDate || !term.endDate) return;
    const start = toDate(term.startDate);
    const end = toDate(term.endDate);
    // Anchors each month to day 1, so a term starting on day 29-31 does not skip short months.
    for (const key of monthKeysInRange(start, end)) {
      monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + monthlyPremium);
    }
  }

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
   * The purchase price is counted only in the all-time total. The financing bucket holds full loan
   * payments, which retire the same principal, so it is dropped whenever the price is counted to avoid
   * double-counting. Returns the financing value actually included so the breakdown sums to the total.
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

  async getFuelEfficiencyTrend(userId: string, vehicleId?: string): Promise<FuelEfficiencyPoint[]> {
    try {
      // Filters on the denormalized expenses.userId rather than joining vehicles.
      const conditions = [
        eq(expenses.userId, userId),
        eq(expenses.category, 'fuel'),
        isNotNull(expenses.mileage),
        isNotNull(expenses.volume),
      ];
      if (vehicleId) conditions.push(eq(expenses.vehicleId, vehicleId));
      const rows = await this.db
        .select({
          vehicleId: expenses.vehicleId,
          date: expenses.date,
          mileage: expenses.mileage,
          volume: expenses.volume,
          fuelType: expenses.fuelType,
          missedFillup: expenses.missedFillup,
        })
        .from(expenses)
        .where(and(...conditions))
        .orderBy(asc(expenses.vehicleId), asc(expenses.date));
      if (rows.length < 2) return [];
      const points: FuelEfficiencyPoint[] = [];
      forEachVehiclePair(rows, (current, previous) => {
        // Gas-only: PHEV charge sessions would otherwise pollute the mi/gal trend.
        const point = gasEfficiencyPoint(current as FuelRow, previous as FuelRow);
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
      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits);
      const avgEfficiency = this.computeAverageEfficiency(fuelRows, convert);

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

  private async computeFleetHealthScore(
    vehicleRows: Array<{ id: string }>,
    userId: string
  ): Promise<number> {
    const vehicleIds = vehicleRows.map((v) => v.id);

    const allMaintenance = await this.db
      .select({
        vehicleId: expenses.vehicleId,
        date: expenses.date,
        mileage: expenses.mileage,
      })
      .from(expenses)
      .where(and(inArray(expenses.vehicleId, vehicleIds), eq(expenses.category, 'maintenance')))
      .orderBy(asc(expenses.date));

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

    const coveredVehicleIds = await this.queryCoveredVehicleIds(vehicleIds, userId);

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

  private async queryCoveredVehicleIds(vehicleIds: string[], userId: string): Promise<Set<string>> {
    if (vehicleIds.length === 0) return new Set();

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

  async getFuelStats(userId: string, range: DateRange, vehicleId?: string): Promise<FuelStatsData> {
    try {
      const prevRange: DateRange = {
        start: range.start - (range.end - range.start),
        end: range.start,
      };
      const [vehicleNameMap, fuelRows, prevYearAgg, userUnits, vehicleUnitsMap] = await Promise.all(
        [
          this.queryVehicleNameMap(userId, vehicleId),
          this.queryFuelExpenses(userId, range, vehicleId),
          this.queryFuelAggregates(userId, prevRange, vehicleId),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]
      );

      const fuelRowsByVehicle = sortByVehicleThenDate(fuelRows);

      return this.buildFuelStatsFromData(
        fuelRows,
        fuelRowsByVehicle,
        vehicleNameMap,
        range,
        prevYearAgg,
        this.fleetUnitConverter(vehicleUnitsMap, userUnits)
      );
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute fuel stats', {
        userId,
        range,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute fuel stats', error);
    }
  }

  private buildFuelStatsFromData(
    fuelRows: FuelExpenseRow[],
    fuelRowsByVehicle: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>,
    range: DateRange,
    prevYearAgg: { count: number; volumeByVehicle: Map<string, number> },
    convert: FleetUnitConverter
  ): FuelStatsData {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const rangeStartDate = new Date(range.start * 1000);
    const rangeEndDate = new Date(range.end * 1000);

    // Split fuel siblings lack volume, so they must not count as fillups.
    const currentYearFillups = fuelRows.filter(isFillup).length;
    const previousYearFillups = prevYearAgg.count;
    // Month matching must include the year, since the range can span several years.
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const inCurrentMonth = (r: FuelExpenseRow) => {
      const d = toDate(r.date ?? 0);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    };
    const inPrevMonth = (r: FuelExpenseRow) => {
      const d = toDate(r.date ?? 0);
      return d.getMonth() === prevMonth && d.getFullYear() === prevMonthYear;
    };
    const currentMonthFillups = fuelRows.filter((r) => isFillup(r) && inCurrentMonth(r)).length;
    const prevMonthFillups = fuelRows.filter((r) => isFillup(r) && inPrevMonth(r)).length;

    const sumGallons = (rows: FuelExpenseRow[]) =>
      rows.reduce((s, r) => s + this.rowVolume(r, convert), 0);
    const currentYearGallons = sumGallons(fuelRows);
    // Prior-year volume is grouped per vehicle so each vehicle's sum converts before pooling.
    const previousYearGallons = [...prevYearAgg.volumeByVehicle.entries()].reduce(
      (s, [vId, vol]) => s + convert.volume(vol, vId),
      0
    );
    const currentMonthGallons = sumGallons(fuelRows.filter(inCurrentMonth));
    const prevMonthGallons = sumGallons(fuelRows.filter(inPrevMonth));

    const { mpgValues, costPerMileValues } = computeMpgAndCostPerMile(fuelRowsByVehicle);
    const fuelConsumption = computeFuelConsumptionMetrics(mpgValues);

    const volumes = fuelRows
      .filter((r) => r.volume != null && r.volume > 0)
      .map((r) => this.rowVolume(r, convert));
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

    // Distance is max-min per vehicle, then summed; pooling odometers would invent a span across cars.
    const totalDistance = this.computeTotalDistance(fuelRows, convert);
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
      monthlyConsumption: this.buildMonthlyConsumption(fuelRowsByVehicle, convert),
      gasPriceHistory: buildGasPriceHistory(fuelRows),
      fillupCostByVehicle: buildFillupCostByVehicle(fuelRows, vehicleNameMap),
      odometerProgression: this.buildOdometerProgression(fuelRows, vehicleNameMap),
      costPerDistance: buildCostPerDistanceChart(fuelRowsByVehicle, vehicleNameMap),
    };
  }

  async getFuelAdvanced(
    userId: string,
    range: DateRange,
    vehicleId?: string
  ): Promise<FuelAdvancedData> {
    try {
      const [vehicleNameMap, fuelRows, allExpenses, userUnits, vehicleUnitsMap] = await Promise.all(
        [
          this.queryVehicleNameMap(userId, vehicleId),
          this.queryFuelExpenses(userId, range, vehicleId),
          this.queryAllExpenses(userId, range, vehicleId),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]
      );

      return this.buildFuelAdvancedFromData(
        fuelRows,
        sortByVehicleThenDate(fuelRows),
        allExpenses,
        vehicleNameMap,
        this.fleetUnitConverter(vehicleUnitsMap, userUnits)
      );
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute fuel advanced analytics', {
        userId,
        range,
        vehicleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute fuel advanced analytics', error);
    }
  }

  private buildFuelAdvancedFromData(
    fuelRows: FuelExpenseRow[],
    fuelRowsByVehicle: FuelExpenseRow[],
    allExpenses: GeneralExpenseRow[],
    vehicleNameMap: Map<string, string>,
    convert: FleetUnitConverter
  ): FuelAdvancedData {
    const maintenanceRows = allExpenses.filter((e) => e.category === 'maintenance');
    return {
      maintenanceTimeline: buildMaintenanceTimeline(maintenanceRows, new Date()),
      seasonalEfficiency: this.buildSeasonalEfficiency(fuelRowsByVehicle, convert),
      // Radar min/max normalization ranks across the fleet, so mixed units must convert before it runs.
      vehicleRadar: buildVehicleRadar(allExpenses, fuelRowsByVehicle, vehicleNameMap, convert),
      dayOfWeekPatterns: this.buildDayOfWeekPatterns(fuelRows, convert),
      monthlyCostHeatmap: buildMonthlyCostHeatmap(allExpenses),
      fillupIntervals: buildFillupIntervals(fuelRows),
    };
  }

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

      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits);

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
        const rawDist =
          data && data.maxMileage > 0 && data.minMileage < Number.POSITIVE_INFINITY
            ? data.maxMileage - data.minMileage
            : 0;
        const totalDist = rawDist > 0 ? convert.distance(rawDist, vId) : 0;

        return {
          vehicleId: vId,
          vehicleName: vName,
          totalCost,
          costPerDistance: totalDist > 0 ? totalCost / totalDist : null,
        };
      });

      return {
        monthlyExpenseTrends: buildMonthlyExpenseTrends(allExpenses),
        expenseByCategory: buildExpenseByCategory(allExpenses),
        vehicleCostComparison,
        fuelEfficiencyComparison: this.buildFuelEfficiencyComparison(
          fuelRows,
          vehicleNameMap,
          convert
        ),
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
      const balances = await this.computeActiveBalances(financingRows);
      const {
        vehicleDetails,
        totalMonthlyPayments,
        remainingBalance,
        loanCount,
        leaseCount,
        activeIds,
      } = this.buildFinancingVehicleDetails(financingRows, vehicleNameMap, balances);

      const monthlyTimeline = this.buildFinancingTimeline(vehicleDetails);

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
        loanBreakdown: this.buildLoanBreakdown(financingRows, balances),
      };
    } catch (error) {
      logger.error('Failed to compute financing analytics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute financing analytics', error);
    }
  }

  async getInsurance(userId: string): Promise<InsuranceData> {
    try {
      const vehicleNameMap = await this.queryVehicleNameMap(userId);
      const emptyResult: InsuranceData = {
        summary: { totalMonthlyPremiums: 0, totalAnnualPremiums: 0, activePoliciesCount: 0 },
        vehicleDetails: [],
        monthlyPremiumTrend: [],
        costByCarrier: [],
      };

      const policyRows = await this.db
        .select()
        .from(insurancePolicies)
        .where(eq(insurancePolicies.userId, userId));
      if (policyRows.length === 0) return emptyResult;

      const policyIds = policyRows.map((p) => p.id);

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

      // Only policies with a term count, matching the premium path, so the count agrees with the totals.
      const policyIdsWithTerms = new Set(termRows.map((t) => t.policyId));
      const activePoliciesWithTerms = activePolicies.filter((p) => policyIdsWithTerms.has(p.id));

      return {
        summary: {
          totalMonthlyPremiums,
          totalAnnualPremiums,
          activePoliciesCount: activePoliciesWithTerms.length,
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
      const ownershipStart = purchaseDate ? toDate(purchaseDate) : now;
      // The divisor must cover the same window as the total.
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
      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits);
      const totalDistance = this.computeTotalDistance(fuelRows, convert);
      const avgEfficiency = this.computeAverageEfficiency(fuelRows, convert);
      const efficiencyTrend = this.buildEfficiencyTrend(fuelRows, convert);

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

      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits);
      const avgEfficiency = this.computeAverageEfficiency(fuelRows, convert);
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
        prevYearAgg,
        convert
      );
      const fuelAdvanced = this.buildFuelAdvancedFromData(
        fuelRows,
        fuelRowsByVehicle,
        allExpenses,
        vehicleNameMap,
        convert
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

export const analyticsRepository = new AnalyticsRepository(getDb());
