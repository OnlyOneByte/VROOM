import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { getDb } from '../../db/connection';
import { countNum, sqlFalse, sumNum } from '../../db/dialect';
import {
  expenses,
  insurancePolicies,
  insuranceTerms,
  insuranceTermVehicles,
  userPreferences,
  vehicleFinancing,
  vehicles,
} from '../../db/schema';
import { ELECTRIC_FUEL_TYPES, isElectricFuelType } from '../../db/types';
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
  buildVehicleExpenseBreakdown,
  buildVehicleMaintenanceCosts,
  buildVehicleRadar,
  type Calendar,
  type CategoryAmounts,
  calendarParts,
  computeAverageCosts,
  computeEfficiencyPoint,
  computeMileageScore,
  computeMonthlySpend,
  computeMpgAndCostPerMile,
  computePreviousYearComparison,
  computeRegularityScore,
  DAY_NAMES,
  effectiveMonthlyPremium,
  efficiencyRange,
  type FuelEfficiencyPoint,
  type FuelExpenseRow,
  type FuelRow,
  findBiggestExpense,
  type GeneralExpenseRow,
  isChargeSession,
  isFillup,
  normalizeDate,
  type RadarUnitConverters,
  SEASON_MAP,
  sameEnergyPairs,
  shiftedMonthKey,
  sortByVehicleThenDate,
  toMonthKey,
  UTC_CALENDAR,
  weekdayOf,
  zonedCalendar,
} from '../../utils/analytics-charts';
import { maxOf, minOf, termBillingMonths } from '../../utils/calculations';
import { logger } from '../../utils/logger';
import {
  canonicalScale,
  convertDistance,
  convertEfficiency,
  convertVolume,
  type UnitScale,
} from '../../utils/unit-conversions';
import { hiddenFinancialsScope, ownedVehiclesScope } from '../../utils/vehicle-access';
import { FinancingRepository } from '../financing/repository';
import { isTermInForce, termInForceAt } from '../insurance/in-force';

export type { FuelEfficiencyPoint } from '../../utils/analytics-charts';

export type VehicleFilter = readonly string[] | undefined;

function termVehicleIds(
  junctionRows: Array<{ termId: string; vehicleId: string }>,
  termId: string
): string[] {
  return [...new Set(junctionRows.filter((j) => j.termId === termId).map((j) => j.vehicleId))];
}

function selectedShare(covered: string[], selected: ReadonlySet<string> | undefined): number {
  if (!selected) return 1;
  if (covered.length === 0) return 0;
  return covered.filter((id) => selected.has(id)).length / covered.length;
}

function vehicleFilterCondition(
  column: typeof expenses.vehicleId | typeof vehicles.id,
  filter: VehicleFilter
): SQL | undefined {
  if (!filter) return undefined;
  return filter.length > 0 ? inArray(column, [...filter]) : sqlFalse;
}

function toVehicleFilter(vehicles: string | VehicleFilter): VehicleFilter {
  return typeof vehicles === 'string' ? [vehicles] : vehicles;
}

export function monthsOwnedInYear(
  ownershipStart: Date,
  now: Date,
  year: number,
  calendar: Calendar = UTC_CALENDAR
): number {
  const start = calendarParts(ownershipStart, calendar);
  const end = calendarParts(now, calendar);
  const yearStartMonth = start.year < year ? 0 : start.month;
  const yearEndMonth = end.year > year ? 11 : end.month;
  if (start.year > year || end.year < year) return 0;
  return Math.max(0, yearEndMonth - yearStartMonth + 1);
}

export function monthsBetween(from: Date, to: Date, calendar: Calendar = UTC_CALENDAR): number {
  const a = calendarParts(from, calendar);
  const b = calendarParts(to, calendar);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function yearToDateSpending(
  rows: Array<{ date: Date | number | null; expenseAmount: number }>,
  range: DateRange,
  ytdStart?: number
): number {
  const lastInstant = new Date(range.end * 1000 - 1);
  const yearStart =
    ytdStart != null ? ytdStart * 1000 : Date.UTC(lastInstant.getUTCFullYear(), 0, 1);
  let total = 0;
  for (const row of rows) {
    if (row.date != null && toDate(row.date).getTime() >= yearStart) total += row.expenseAmount;
  }
  return total;
}

export function calendarYearRange(
  year: number,
  calendar: Calendar = UTC_CALENDAR
): { start: Date; end: Date } {
  return { start: calendar.yearStart(year), end: calendar.yearStart(year + 1) };
}

interface FleetUnitConverter extends RadarUnitConverters {
  volume: (value: number, vehicleId: string) => number;
  scale: (vehicleId: string) => UnitScale;
  calendar: Calendar;
}

const identity = (value: number) => value;

interface EfficiencyTotals {
  distance: number;
  energy: number;
}

const emptyTotals = (): EfficiencyTotals => ({ distance: 0, energy: 0 });

function addInterval(totals: EfficiencyTotals, interval: EfficiencyTotals): void {
  totals.distance += interval.distance;
  totals.energy += interval.energy;
}

function pooledEfficiency(totals: EfficiencyTotals | undefined): number | null {
  return totals && totals.energy > 0 ? totals.distance / totals.energy : null;
}

export interface QuickStatsData {
  vehicleCount: number;
  ytdSpending: number;
  avgEfficiency: number | null;
  costPerDistance: number | null;
  fleetHealthScore: number;
  units: { distanceUnit: string; volumeUnit: string; chargeUnit: string };
}

interface PeriodCounts {
  currentYear: number;
  previousYear: number;
  currentMonth: number;
  previousMonth: number;
}

interface FuelAggregates {
  count: number;
  volumeByVehicle: Map<string, number>;
  chargeCount: number;
  chargeEnergy: number;
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
    costPerDistance: number | null;
  };
  monthlySpend: { months: number; fuel: number | null; charging: number | null } | null;
  previous: {
    costPerDistance: number | null;
    monthlySpend: { months: number; fuel: number | null; charging: number | null } | null;
    avgEfficiency: number | null;
    chargeAvgEfficiency: number | null;
  };
  distance: {
    totalDistance: number;
    avgPerDay: number | null;
    avgPerMonth: number | null;
  };
  monthlyConsumption: Array<{ month: string; efficiency: number | null; volume: number }>;
  gasPriceHistory: Array<{
    date: string;
    month: string;
    fuelType: string;
    pricePerVolume: number;
  }>;
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
  charging: {
    sessions: PeriodCounts;
    energy: PeriodCounts;
    efficiency: {
      avgEfficiency: number | null;
      bestEfficiency: number | null;
      worstEfficiency: number | null;
    };
    sessionDetails: {
      avgEnergy: number | null;
      minEnergy: number | null;
      maxEnergy: number | null;
    };
    averageCost: { perSession: number | null; perEnergyUnit: number | null };
    priceHistory: Array<{ date: string; month: string; fuelType: string; pricePerVolume: number }>;
  };
  costPerDistance: Array<{
    month: string;
    vehicleId: string;
    vehicleName: string;
    costPerDistance: number;
  }>;
}

export interface FuelAdvancedData {
  maintenanceTimeline: Array<{
    vehicleId: string;
    vehicleName: string;
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
    fuelEfficiency: number | null;
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
  monthlyCostHeatmap: Array<{ month: string } & CategoryAmounts>;
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

interface VehicleHealthData {
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

  // Do not reuse for getAllVehicleUnits: that path must throw on invalid prefs, not default.
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
        .where(ownedVehiclesScope(userId));

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

  private vehicleUnitsFor(
    vehicleUnitsMap: Map<string, UnitPreferences>,
    vehicleId: string
  ): UnitPreferences {
    return vehicleUnitsMap.get(vehicleId) ?? { ...DEFAULT_UNIT_PREFERENCES };
  }

  private fleetUnitConverter(
    vehicleUnitsMap: Map<string, UnitPreferences>,
    userUnits: UnitPreferences,
    calendar: Calendar = UTC_CALENDAR
  ): FleetUnitConverter {
    const scale = (vehicleId: string) =>
      canonicalScale(this.vehicleUnitsFor(vehicleUnitsMap, vehicleId));
    if (this.allVehiclesMatchUnits(vehicleUnitsMap, userUnits)) {
      return { efficiency: identity, distance: identity, volume: identity, scale, calendar };
    }
    return {
      scale,
      calendar,
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
    return isFillup(row) ? convert.volume(row.volume as number, row.vehicleId) : 0;
  }

  private *efficiencyIntervals(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter,
    electric = false
  ): Generator<EfficiencyTotals & { vehicleId: string; date: string }> {
    for (const [current, previous] of sameEnergyPairs(fuelRows)) {
      if (isChargeSession(current) !== electric) continue;
      const vehicleId = current.vehicleId;
      const point = computeEfficiencyPoint(current, previous, convert.scale(vehicleId));
      if (!point) continue;
      const volume = current.volume as number;
      yield {
        vehicleId,
        date: point.date,
        distance: convert.distance(
          (current.mileage as number) - (previous.mileage as number),
          vehicleId
        ),
        energy: electric ? volume : convert.volume(volume, vehicleId),
      };
    }
  }

  private computeAverageEfficiency(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter,
    electric = false
  ): number | null {
    const totals = emptyTotals();
    for (const interval of this.efficiencyIntervals(fuelRows, convert, electric)) {
      addInterval(totals, interval);
    }
    return pooledEfficiency(totals);
  }

  private costPerDistance(
    rows: Array<{ vehicleId: string; mileage: number | null; expenseAmount: number }>,
    convert: FleetUnitConverter,
    distanceRows: Array<{ vehicleId: string; mileage: number | null }> = rows
  ): number | null {
    const distances = this.distanceByVehicle(distanceRows, convert);
    let distance = 0;
    for (const d of distances.values()) distance += d;
    if (distance <= 0) return null;
    const spend = rows.reduce(
      (sum, r) => (distances.has(r.vehicleId) && r.expenseAmount > 0 ? sum + r.expenseAmount : sum),
      0
    );
    return spend / distance;
  }

  private distanceByVehicle(
    rows: Array<{ vehicleId: string; mileage: number | null }>,
    convert: FleetUnitConverter
  ): Map<string, number> {
    const vehicleMileages = new Map<string, number[]>();
    for (const row of rows) {
      if (row.mileage == null) continue;
      const arr = vehicleMileages.get(row.vehicleId) ?? [];
      arr.push(row.mileage);
      vehicleMileages.set(row.vehicleId, arr);
    }
    const distances = new Map<string, number>();
    for (const [vId, mileages] of vehicleMileages) {
      if (mileages.length < 2) continue;
      const distance = maxOf(mileages) - minOf(mileages);
      if (distance > 0) distances.set(vId, convert.distance(distance, vId));
    }
    return distances;
  }

  private computeTotalDistance(
    rows: Array<{ vehicleId: string; mileage: number | null }>,
    convert: FleetUnitConverter
  ): number {
    let total = 0;
    for (const d of this.distanceByVehicle(rows, convert).values()) total += d;
    return total;
  }

  private buildMonthlyConsumption(
    rows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Array<{ month: string; efficiency: number | null; volume: number }> {
    const map = new Map<string, { efficiency: EfficiencyTotals; volume: number }>();

    for (const row of rows) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      const key = toMonthKey(d, convert.calendar);
      const entry = map.get(key) ?? { efficiency: emptyTotals(), volume: 0 };
      entry.volume += this.rowVolume(row, convert);
      map.set(key, entry);
    }

    for (const interval of this.efficiencyIntervals(rows, convert)) {
      const entry = map.get(toMonthKey(new Date(interval.date), convert.calendar));
      if (entry) addInterval(entry.efficiency, interval);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, data]) => ({
        month,
        efficiency: pooledEfficiency(data.efficiency),
        volume: data.volume,
      }));
  }

  private buildSeasonalEfficiency(
    fuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): Array<{ season: string; avgEfficiency: number; fillupCount: number }> {
    const seasonData = new Map<string, { efficiency: EfficiencyTotals; fillupCount: number }>();

    for (const row of fuelRows) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      if (!isFillup(row)) continue;
      const season = SEASON_MAP[calendarParts(d, convert.calendar).month] ?? 'Winter';
      const entry = seasonData.get(season) ?? { efficiency: emptyTotals(), fillupCount: 0 };
      entry.fillupCount++;
      seasonData.set(season, entry);
    }

    for (const interval of this.efficiencyIntervals(fuelRows, convert)) {
      const month = calendarParts(new Date(interval.date), convert.calendar).month;
      const entry = seasonData.get(SEASON_MAP[month] ?? 'Winter');
      if (entry) addInterval(entry.efficiency, interval);
    }

    return ['Winter', 'Spring', 'Summer', 'Fall'].map((season) => {
      const data = seasonData.get(season);
      return {
        season,
        avgEfficiency: pooledEfficiency(data?.efficiency) ?? 0,
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
      const dayName = DAY_NAMES[weekdayOf(d, convert.calendar)] ?? 'Sunday';
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
    const monthMap = new Map<string, EfficiencyTotals>();

    for (const interval of this.efficiencyIntervals(fuelRows, convert)) {
      const month = toMonthKey(new Date(interval.date), convert.calendar);
      const totals = monthMap.get(month) ?? emptyTotals();
      addInterval(totals, interval);
      monthMap.set(month, totals);
    }

    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, totals]) => ({
        month,
        efficiency: pooledEfficiency(totals) ?? 0,
      }));
  }

  private buildFuelEfficiencyComparison(
    fuelRows: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>,
    convert: FleetUnitConverter
  ): CrossVehicleData['fuelEfficiencyComparison'] {
    const monthVehicleEff = new Map<string, Map<string, EfficiencyTotals>>();
    for (const interval of this.efficiencyIntervals(fuelRows, convert)) {
      const month = toMonthKey(new Date(interval.date), convert.calendar);
      if (!monthVehicleEff.has(month)) monthVehicleEff.set(month, new Map());
      const vehicleMap = monthVehicleEff.get(month) as Map<string, EfficiencyTotals>;
      const totals = vehicleMap.get(interval.vehicleId) ?? emptyTotals();
      addInterval(totals, interval);
      vehicleMap.set(interval.vehicleId, totals);
    }

    return Array.from(monthVehicleEff.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-24)
      .map(([month, vehicleMap]) => ({
        month,
        vehicles: Array.from(vehicleMap.entries()).map(([vId, data]) => ({
          vehicleId: vId,
          vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
          efficiency: pooledEfficiency(data) ?? 0,
        })),
      }));
  }

  private async queryVehicleNameMap(
    userId: string,
    filter?: VehicleFilter
  ): Promise<Map<string, string>> {
    const all = await this.queryAllVehicleNames(userId);
    if (!filter) return all;
    const picked = new Set(filter);
    return new Map([...all].filter(([id]) => picked.has(id)));
  }

  private async queryAllVehicleNames(userId: string): Promise<Map<string, string>> {
    const now = Date.now();
    const cached = this.getCachedVehicleNames(userId, now);
    if (cached) return cached;

    const rows = await this.db
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        nickname: vehicles.nickname,
      })
      .from(vehicles)
      .where(ownedVehiclesScope(userId));
    const map = new Map<string, string>();
    for (const r of rows) {
      const base = `${r.year} ${r.make} ${r.model}`;
      map.set(r.id, r.nickname ? `${base} (${r.nickname})` : base);
    }

    this.storeVehicleNameCache(userId, map, now);
    return map;
  }

  private async queryFuelExpenses(
    userId: string,
    range?: DateRange,
    filter?: VehicleFilter
  ): Promise<FuelExpenseRow[]> {
    const conditions = [eq(expenses.userId, userId), eq(expenses.category, 'fuel')];
    const vehicleCondition = vehicleFilterCondition(expenses.vehicleId, filter);
    if (vehicleCondition) conditions.push(vehicleCondition);
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
      .orderBy(asc(expenses.date), asc(expenses.mileage));
  }

  private async queryAllExpenses(
    userId: string,
    range?: DateRange,
    filter?: VehicleFilter,
    hideFinancials = false
  ): Promise<GeneralExpenseRow[]> {
    const conditions = [eq(expenses.userId, userId)];
    const vehicleCondition = vehicleFilterCondition(expenses.vehicleId, filter);
    if (vehicleCondition) conditions.push(vehicleCondition);
    if (hideFinancials) conditions.push(hiddenFinancialsScope());
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
        fuelType: expenses.fuelType,
        missedFillup: expenses.missedFillup,
      })
      .from(expenses)
      .where(and(...conditions))
      .orderBy(asc(expenses.date), asc(expenses.mileage));
  }

  private async queryTotalSpending(
    userId: string,
    year: number,
    calendar: Calendar
  ): Promise<number> {
    const { start: yearStart, end: yearEnd } = calendarYearRange(year, calendar);
    const result = await this.db
      .select({ total: sumNum(expenses.expenseAmount) })
      .from(expenses)
      .where(
        and(eq(expenses.userId, userId), gte(expenses.date, yearStart), lt(expenses.date, yearEnd))
      );
    return result[0]?.total ?? 0;
  }

  private async queryFuelAggregates(
    userId: string,
    range: DateRange,
    filter?: VehicleFilter
  ): Promise<FuelAggregates> {
    const conditions = [
      eq(expenses.userId, userId),
      eq(expenses.category, 'fuel'),
      gte(expenses.date, new Date(range.start * 1000)),
      lt(expenses.date, new Date(range.end * 1000)),
    ];
    const vehicleCondition = vehicleFilterCondition(expenses.vehicleId, filter);
    if (vehicleCondition) conditions.push(vehicleCondition);
    const isCharge = inArray(expenses.fuelType, [...ELECTRIC_FUEL_TYPES]);
    const isGas = or(
      isNull(expenses.fuelType),
      notInArray(expenses.fuelType, [...ELECTRIC_FUEL_TYPES])
    );
    const rows = await this.db
      .select({
        vehicleId: expenses.vehicleId,
        count: countNum(sql`CASE WHEN ${expenses.volume} > 0 AND ${isGas} THEN 1 END`),
        totalGallons: sumNum(sql`CASE WHEN ${isGas} THEN ${expenses.volume} END`),
        chargeCount: countNum(sql`CASE WHEN ${expenses.volume} > 0 AND ${isCharge} THEN 1 END`),
        chargeEnergy: sumNum(sql`CASE WHEN ${isCharge} THEN ${expenses.volume} END`),
      })
      .from(expenses)
      .where(and(...conditions))
      .groupBy(expenses.vehicleId);
    const agg: FuelAggregates = {
      count: 0,
      volumeByVehicle: new Map(),
      chargeCount: 0,
      chargeEnergy: 0,
    };
    for (const r of rows) {
      agg.count += r.count;
      agg.chargeCount += r.chargeCount;
      agg.chargeEnergy += r.chargeEnergy;
      if (r.totalGallons > 0) agg.volumeByVehicle.set(r.vehicleId, r.totalGallons);
    }
    return agg;
  }

  private buildOdometerProgression(
    fuelRows: FuelExpenseRow[],
    vehicleNameMap: Map<string, string>,
    calendar: Calendar
  ): Array<{ month: string; vehicleId: string; vehicleName: string; mileage: number }> {
    const map = new Map<string, { mileage: number }>();
    for (const row of fuelRows) {
      if (row.mileage == null || !row.date) continue;
      const d = toDate(row.date);
      const key = `${toMonthKey(d, calendar)}|${row.vehicleId}`;
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

  private async computeActiveBalances(
    financingRows: Array<{ id: string; isActive: boolean }>,
    timeZone: string | undefined
  ): Promise<Map<string, number>> {
    return new FinancingRepository(this.db).computeBalances(
      financingRows.filter((fin) => fin.isActive).map((fin) => fin.id),
      timeZone
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
    balances: Map<string, number>,
    calendar: Calendar
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
      vehicleDetails.push(
        this.buildSingleFinancingDetail(fin, vehicleNameMap, computedBalance, calendar)
      );
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
    computedBalance: number,
    calendar: Calendar
  ): FinancingData['vehicleDetails'][number] {
    const monthlyInterestEstimate =
      fin.financingType === 'loan' && fin.apr ? (computedBalance * (fin.apr / 100)) / 12 : 0;
    const startDate = toDate(fin.startDate ?? 0);
    const now = new Date();
    const monthsElapsed = Math.max(0, monthsBetween(startDate, now, calendar));
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
    vehicleDetails: FinancingData['vehicleDetails'],
    calendar: Calendar
  ): FinancingData['monthlyTimeline'] {
    const now = new Date();
    const maxMonths = Math.max(
      ...vehicleDetails.map((d) => d.monthsRemaining).filter((m) => m > 0),
      0
    );
    const timeline: FinancingData['monthlyTimeline'] = [];
    for (let m = 0; m < Math.min(maxMonths, 24); m++) {
      const monthKey = shiftedMonthKey(now, m, calendar);
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
    balances: Map<string, number>,
    calendar: Calendar
  ): FinancingData['loanBreakdown'] {
    const activeLoans = financingRows.filter((f) => f.isActive && f.financingType === 'loan');
    if (activeLoans.length === 0) return [];

    const now = new Date();

    const loans = activeLoans.map((loan) => ({
      balance: balances.get(loan.id) ?? 0,
      apr: loan.apr ?? 0,
      paymentAmount: loan.paymentAmount,
    }));
    const monthKeys = Array.from({ length: 12 }, (_, m) => shiftedMonthKey(now, m, calendar));

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
    vehicleNameMap: Map<string, string>,
    calendar: Calendar,
    timeZone: string | undefined,
    selected?: ReadonlySet<string>
  ): {
    vehicleDetails: InsuranceData['vehicleDetails'];
    totalMonthlyPremiums: number;
    totalAnnualPremiums: number;
    carrierMap: Map<string, { annualPremium: number; vehicleIds: Set<string> }>;
    monthlyMap: Map<string, number>;
    currentPolicyIds: Set<string>;
  } {
    let totalMonthlyPremiums = 0;
    let totalAnnualPremiums = 0;
    const vehicleDetails: InsuranceData['vehicleDetails'] = [];
    const carrierMap = new Map<string, { annualPremium: number; vehicleIds: Set<string> }>();
    const monthlyMap = new Map<string, number>();
    const currentPolicyIds = new Set<string>();

    const now = new Date();
    for (const policy of activePolicies) {
      const policyTerms = termRows
        .filter((t) => t.policyId === policy.id)
        .sort((a, b) => {
          const aEnd = a.endDate instanceof Date ? a.endDate.getTime() : 0;
          const bEnd = b.endDate instanceof Date ? b.endDate.getTime() : 0;
          if (bEnd !== aEnd) return bEnd - aEnd;
          const aStart = a.startDate instanceof Date ? a.startDate.getTime() : 0;
          const bStart = b.startDate instanceof Date ? b.startDate.getTime() : 0;
          return bStart - aStart;
        });
      const latestTerm = policyTerms[0];
      if (!latestTerm) continue;
      const latestShare = selectedShare(termVehicleIds(junctionRows, latestTerm.id), selected);
      if (latestShare > 0) {
        this.accumulateMonthlyPremiums(
          monthlyMap,
          latestTerm,
          effectiveMonthlyPremium(latestTerm) * latestShare,
          calendar
        );
      }

      const currentTerm = policyTerms.find((t) => isTermInForce(t, now, timeZone));
      if (!currentTerm) continue;
      const allCovered = termVehicleIds(junctionRows, currentTerm.id);
      const share = selectedShare(allCovered, selected);
      if (share === 0) continue;
      currentPolicyIds.add(policy.id);

      const monthlyPremium = effectiveMonthlyPremium(currentTerm) * share;
      const annualPremium = monthlyPremium * 12;
      const coveredVehicleIds = selected ? allCovered.filter((id) => selected.has(id)) : allCovered;

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
        currentTerm
      );
    }

    return {
      vehicleDetails,
      totalMonthlyPremiums,
      totalAnnualPremiums,
      carrierMap,
      monthlyMap,
      currentPolicyIds,
    };
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
    monthlyPremium: number,
    calendar: Calendar
  ): void {
    if (!term.startDate || !term.endDate) return;
    const start = toDate(term.startDate);
    const months = termBillingMonths(start, toDate(term.endDate));
    for (let i = 0; i < months; i++) {
      const key = shiftedMonthKey(start, i, calendar);
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
          vehicleType: vehicles.vehicleType,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.vehicleId), asc(expenses.date), asc(expenses.mileage));
      if (rows.length < 2) return [];
      const vehicleUnitsMap = await this.getAllVehicleUnits(userId);
      const points: FuelEfficiencyPoint[] = [];
      for (const [current, previous] of sameEnergyPairs(rows)) {
        const electricVehicle = current.vehicleType === 'electric';
        if (isElectricFuelType(current.fuelType) !== electricVehicle) continue;
        const scale = canonicalScale(this.vehicleUnitsFor(vehicleUnitsMap, current.vehicleId));
        const point = computeEfficiencyPoint(current as FuelRow, previous as FuelRow, scale);
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

  async getQuickStats(
    userId: string,
    range: DateRange,
    ytdStart?: number,
    timeZone?: string
  ): Promise<QuickStatsData> {
    try {
      const vehicleRows = await this.db
        .select({
          id: vehicles.id,
        })
        .from(vehicles)
        .where(ownedVehiclesScope(userId));

      const vehicleCount = vehicleRows.length;

      const [allExpenses, fuelRows, userUnits, vehicleUnitsMap] = await Promise.all([
        this.queryAllExpenses(userId, range),
        this.queryFuelExpenses(userId, range),
        this.getUserUnits(userId),
        this.getAllVehicleUnits(userId),
      ]);

      const ytdSpending = yearToDateSpending(allExpenses, range, ytdStart);
      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits, zonedCalendar(timeZone));
      const avgEfficiency = this.computeAverageEfficiency(fuelRows, convert);
      const costPerDistance = this.costPerDistance(allExpenses, convert);

      const fleetHealthScore =
        vehicleCount > 0 ? await this.computeFleetHealthScore(vehicleRows, userId, timeZone) : 0;

      return {
        vehicleCount,
        ytdSpending,
        avgEfficiency,
        costPerDistance,
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
    userId: string,
    timeZone: string | undefined
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
      .orderBy(asc(expenses.date), asc(expenses.mileage));

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

    const coveredVehicleIds = await this.queryCoveredVehicleIds(vehicleIds, userId, timeZone);

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

  private async queryCoveredVehicleIds(
    vehicleIds: string[],
    userId: string,
    timeZone: string | undefined
  ): Promise<Set<string>> {
    if (vehicleIds.length === 0) return new Set();
    const now = new Date();

    const rows = await this.db
      .select({ vehicleId: insuranceTermVehicles.vehicleId })
      .from(insuranceTermVehicles)
      .innerJoin(insuranceTerms, eq(insuranceTermVehicles.termId, insuranceTerms.id))
      .innerJoin(insurancePolicies, eq(insuranceTerms.policyId, insurancePolicies.id))
      .where(
        and(
          inArray(insuranceTermVehicles.vehicleId, vehicleIds),
          eq(insurancePolicies.isActive, true),
          eq(insurancePolicies.userId, userId),
          termInForceAt(now, timeZone)
        )
      );

    return new Set(rows.map((r) => r.vehicleId));
  }

  async getFuelStats(
    userId: string,
    range: DateRange,
    vehicles?: string | VehicleFilter,
    timeZone?: string
  ): Promise<FuelStatsData> {
    const filter = toVehicleFilter(vehicles);
    try {
      const prevRange: DateRange = {
        start: range.start - (range.end - range.start),
        end: range.start,
      };
      const [vehicleNameMap, fuelRows, prevFuelRows, prevYearAgg, userUnits, vehicleUnitsMap] =
        await Promise.all([
          this.queryVehicleNameMap(userId, filter),
          this.queryFuelExpenses(userId, range, filter),
          this.queryFuelExpenses(userId, prevRange, filter),
          this.queryFuelAggregates(userId, prevRange, filter),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]);

      const fuelRowsByVehicle = sortByVehicleThenDate(fuelRows);

      return this.buildFuelStatsFromData(
        fuelRows,
        fuelRowsByVehicle,
        vehicleNameMap,
        range,
        prevYearAgg,
        prevFuelRows,
        this.fleetUnitConverter(vehicleUnitsMap, userUnits, zonedCalendar(timeZone))
      );
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute fuel stats', {
        userId,
        range,
        vehicles,
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
    prevYearAgg: FuelAggregates,
    prevFuelRows: FuelExpenseRow[],
    convert: FleetUnitConverter
  ): FuelStatsData {
    const now = new Date();
    const { month: currentMonth, year: currentYear } = calendarParts(now, convert.calendar);
    const rangeStartDate = new Date(range.start * 1000);
    const rangeEndDate = new Date(range.end * 1000);

    const currentYearFillups = fuelRows.filter(isFillup).length;
    const previousYearFillups = prevYearAgg.count;
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const inCurrentMonth = (r: FuelExpenseRow) => {
      const d = toDate(r.date ?? 0);
      const p = calendarParts(d, convert.calendar);
      return p.month === currentMonth && p.year === currentYear;
    };
    const inPrevMonth = (r: FuelExpenseRow) => {
      const d = toDate(r.date ?? 0);
      const p = calendarParts(d, convert.calendar);
      return p.month === prevMonth && p.year === prevMonthYear;
    };
    const currentMonthFillups = fuelRows.filter((r) => isFillup(r) && inCurrentMonth(r)).length;
    const prevMonthFillups = fuelRows.filter((r) => isFillup(r) && inPrevMonth(r)).length;

    const sumGallons = (rows: FuelExpenseRow[]) =>
      rows.reduce((s, r) => s + this.rowVolume(r, convert), 0);
    const currentYearGallons = sumGallons(fuelRows);
    const previousYearGallons = [...prevYearAgg.volumeByVehicle.entries()].reduce(
      (s, [vId, vol]) => s + convert.volume(vol, vId),
      0
    );
    const currentMonthGallons = sumGallons(fuelRows.filter(inCurrentMonth));
    const prevMonthGallons = sumGallons(fuelRows.filter(inPrevMonth));

    const { mpgValues, costPerMileValues } = computeMpgAndCostPerMile(fuelRowsByVehicle, convert);
    const fuelConsumption = {
      ...efficiencyRange(mpgValues),
      avgEfficiency: this.computeAverageEfficiency(fuelRowsByVehicle, convert),
    };

    const volumes = fuelRows.filter(isFillup).map((r) => this.rowVolume(r, convert));
    const fillupDetails = {
      avgVolume: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
      minVolume: volumes.length > 0 ? minOf(volumes) : null,
      maxVolume: volumes.length > 0 ? maxOf(volumes) : null,
    };

    const averageCost = {
      ...computeAverageCosts(fuelRows, costPerMileValues, rangeStartDate, rangeEndDate, now),
      costPerDistance: this.costPerDistance(fuelRows, convert),
    };

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
      monthlySpend: computeMonthlySpend(
        fuelRows,
        new Date(Math.min(now.getTime(), rangeEndDate.getTime()))
      ),
      previous: this.previousWindowStats(prevFuelRows, rangeStartDate, convert),
      distance,
      monthlyConsumption: this.buildMonthlyConsumption(fuelRowsByVehicle, convert),
      gasPriceHistory: buildGasPriceHistory(fuelRows, isFillup, convert.volume, convert.calendar),
      fillupCostByVehicle: buildFillupCostByVehicle(fuelRows, vehicleNameMap, convert.calendar),
      odometerProgression: this.buildOdometerProgression(
        fuelRows,
        vehicleNameMap,
        convert.calendar
      ),
      costPerDistance: buildCostPerDistanceChart(fuelRowsByVehicle, vehicleNameMap, convert),
      charging: this.buildChargingStats(fuelRows, fuelRowsByVehicle, prevYearAgg, convert, {
        inCurrentMonth,
        inPrevMonth,
      }),
    };
  }

  private previousWindowStats(
    prevFuelRows: FuelExpenseRow[],
    prevEnd: Date,
    convert: FleetUnitConverter
  ): FuelStatsData['previous'] {
    const byVehicle = sortByVehicleThenDate(prevFuelRows);
    return {
      costPerDistance: this.costPerDistance(prevFuelRows, convert),
      monthlySpend: computeMonthlySpend(prevFuelRows, prevEnd),
      avgEfficiency: this.computeAverageEfficiency(byVehicle, convert),
      chargeAvgEfficiency: this.computeAverageEfficiency(byVehicle, convert, true),
    };
  }

  private buildChargingStats(
    fuelRows: FuelExpenseRow[],
    fuelRowsByVehicle: FuelExpenseRow[],
    prevYearAgg: FuelAggregates,
    convert: FleetUnitConverter,
    months: {
      inCurrentMonth: (r: FuelExpenseRow) => boolean;
      inPrevMonth: (r: FuelExpenseRow) => boolean;
    }
  ): FuelStatsData['charging'] {
    const sessions = fuelRows.filter(isChargeSession);
    const energyOf = (rows: FuelExpenseRow[]) => rows.reduce((s, r) => s + (r.volume ?? 0), 0);
    const totalEnergy = energyOf(sessions);
    const totalCost = sessions.reduce((s, r) => s + r.expenseAmount, 0);

    const efficiencyValues = Array.from(
      this.efficiencyIntervals(fuelRowsByVehicle, convert, true),
      (interval) => interval.distance / interval.energy
    );

    return {
      sessions: {
        currentYear: sessions.length,
        previousYear: prevYearAgg.chargeCount,
        currentMonth: sessions.filter(months.inCurrentMonth).length,
        previousMonth: sessions.filter(months.inPrevMonth).length,
      },
      energy: {
        currentYear: totalEnergy,
        previousYear: prevYearAgg.chargeEnergy,
        currentMonth: energyOf(sessions.filter(months.inCurrentMonth)),
        previousMonth: energyOf(sessions.filter(months.inPrevMonth)),
      },
      efficiency: {
        ...efficiencyRange(efficiencyValues),
        avgEfficiency: this.computeAverageEfficiency(fuelRowsByVehicle, convert, true),
      },
      sessionDetails: {
        avgEnergy: sessions.length > 0 ? totalEnergy / sessions.length : null,
        minEnergy: sessions.length > 0 ? minOf(sessions.map((r) => r.volume as number)) : null,
        maxEnergy: sessions.length > 0 ? maxOf(sessions.map((r) => r.volume as number)) : null,
      },
      averageCost: {
        perSession: sessions.length > 0 ? totalCost / sessions.length : null,
        perEnergyUnit: totalEnergy > 0 ? totalCost / totalEnergy : null,
      },
      priceHistory: buildGasPriceHistory(
        fuelRows,
        isChargeSession,
        (value) => value,
        convert.calendar
      ),
    };
  }

  async getFuelAdvanced(
    userId: string,
    range: DateRange,
    vehicles?: string | VehicleFilter,
    timeZone?: string
  ): Promise<FuelAdvancedData> {
    const filter = toVehicleFilter(vehicles);
    try {
      const [vehicleNameMap, fuelRows, allExpenses, userUnits, vehicleUnitsMap] = await Promise.all(
        [
          this.queryVehicleNameMap(userId, filter),
          this.queryFuelExpenses(userId, range, filter),
          this.queryAllExpenses(userId, range, filter),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]
      );

      return this.buildFuelAdvancedFromData(
        fuelRows,
        sortByVehicleThenDate(fuelRows),
        allExpenses,
        vehicleNameMap,
        this.fleetUnitConverter(vehicleUnitsMap, userUnits, zonedCalendar(timeZone))
      );
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      logger.error('Failed to compute fuel advanced analytics', {
        userId,
        range,
        vehicles,
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
      maintenanceTimeline: buildMaintenanceTimeline(maintenanceRows, new Date(), vehicleNameMap),
      seasonalEfficiency: this.buildSeasonalEfficiency(fuelRowsByVehicle, convert),
      vehicleRadar: buildVehicleRadar(allExpenses, fuelRowsByVehicle, vehicleNameMap, convert),
      dayOfWeekPatterns: this.buildDayOfWeekPatterns(fuelRows, convert),
      monthlyCostHeatmap: buildMonthlyCostHeatmap(allExpenses, convert.calendar),
      fillupIntervals: buildFillupIntervals(fuelRows),
    };
  }

  async getCrossVehicle(
    userId: string,
    range: DateRange,
    timeZone?: string,
    filter?: VehicleFilter
  ): Promise<CrossVehicleData> {
    try {
      const [vehicleNameMap, allExpenses, fuelRows, userUnits, vehicleUnitsMap] = await Promise.all(
        [
          this.queryVehicleNameMap(userId, filter),
          this.queryAllExpenses(userId, range, filter),
          this.queryFuelExpenses(userId, range, filter),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]
      );

      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits, zonedCalendar(timeZone));

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
        monthlyExpenseTrends: buildMonthlyExpenseTrends(allExpenses, convert.calendar),
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

  async getFinancing(
    userId: string,
    timeZone?: string,
    filter?: VehicleFilter
  ): Promise<FinancingData> {
    const calendar = zonedCalendar(timeZone);
    try {
      const vehicleNameMap = await this.queryVehicleNameMap(userId, filter);
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
      const balances = await this.computeActiveBalances(financingRows, timeZone);
      const {
        vehicleDetails,
        totalMonthlyPayments,
        remainingBalance,
        loanCount,
        leaseCount,
        activeIds,
      } = this.buildFinancingVehicleDetails(financingRows, vehicleNameMap, balances, calendar);

      const monthlyTimeline = this.buildFinancingTimeline(vehicleDetails, calendar);

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
        loanBreakdown: this.buildLoanBreakdown(financingRows, balances, calendar),
      };
    } catch (error) {
      logger.error('Failed to compute financing analytics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new DatabaseError('Failed to compute financing analytics', error);
    }
  }

  async getInsurance(
    userId: string,
    timeZone?: string,
    filter?: VehicleFilter
  ): Promise<InsuranceData> {
    const calendar = zonedCalendar(timeZone);
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

      const {
        vehicleDetails,
        totalMonthlyPremiums,
        totalAnnualPremiums,
        carrierMap,
        monthlyMap,
        currentPolicyIds,
      } = this.buildInsuranceDetails(
        activePolicies,
        termRows,
        junctionRows,
        vehicleNameMap,
        calendar,
        timeZone,
        filter ? new Set(filter) : undefined
      );

      return {
        summary: {
          totalMonthlyPremiums,
          totalAnnualPremiums,
          activePoliciesCount: currentPolicyIds.size,
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

  async getVehicleHealth(
    userId: string,
    vehicleId: string,
    timeZone?: string
  ): Promise<VehicleHealthData> {
    try {
      const [vehicleNameMap, maintenanceRows] = await Promise.all([
        this.queryVehicleNameMap(userId, [vehicleId]),
        this.db
          .select({ date: expenses.date, mileage: expenses.mileage })
          .from(expenses)
          .where(and(eq(expenses.vehicleId, vehicleId), eq(expenses.category, 'maintenance')))
          .orderBy(asc(expenses.date), asc(expenses.mileage)),
      ]);

      const vehicleName = vehicleNameMap.get(vehicleId) ?? 'Unknown';

      const coveredVehicleIds = await this.queryCoveredVehicleIds([vehicleId], userId, timeZone);
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

  async getVehicleTCO(
    userId: string,
    vehicleId: string,
    year?: number,
    timeZone?: string,
    hideFinancials = false
  ): Promise<VehicleTCOData> {
    const calendar = zonedCalendar(timeZone);
    try {
      const [vehicleNameMap, vehicleRows] = await Promise.all([
        this.queryVehicleNameMap(userId, [vehicleId]),
        this.db
          .select({ purchasePrice: vehicles.purchasePrice, purchaseDate: vehicles.purchaseDate })
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), ownedVehiclesScope(userId)))
          .limit(1),
      ]);
      const vehicleName = vehicleNameMap.get(vehicleId) ?? 'Unknown';
      const vehicle = vehicleRows[0];
      const purchasePrice = hideFinancials ? null : (vehicle?.purchasePrice ?? null);
      const purchaseDate = vehicle?.purchaseDate ?? null;

      const conditions = [eq(expenses.vehicleId, vehicleId), ownedVehiclesScope(userId)];
      if (hideFinancials) conditions.push(hiddenFinancialsScope());
      if (year) {
        const { start: yearStart, end: yearEnd } = calendarYearRange(year, calendar);
        conditions.push(gte(expenses.date, yearStart));
        conditions.push(lt(expenses.date, yearEnd));
      }
      const detailedExpenses = await this.db
        .select({
          category: expenses.category,
          expenseAmount: expenses.expenseAmount,
          sourceType: expenses.sourceType,
          mileage: expenses.mileage,
        })
        .from(expenses)
        .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(asc(expenses.date), asc(expenses.mileage));

      const costs = this.categorizeTCOExpenses(detailedExpenses);
      const { totalCost, countedFinancingInterest } = this.computeTCOTotal(
        costs,
        purchasePrice,
        year
      );

      const now = new Date();
      const ownershipStart = purchaseDate ? toDate(purchaseDate) : now;
      const ownershipMonths = year
        ? Math.max(1, monthsOwnedInYear(ownershipStart, now, year, calendar))
        : Math.max(1, monthsBetween(ownershipStart, now, calendar));
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
    range: DateRange,
    timeZone?: string,
    hideFinancials = false
  ): Promise<VehicleExpensesData> {
    const calendar = zonedCalendar(timeZone);
    try {
      const [allExpenses, vehicleUnitsMap] = await Promise.all([
        this.queryAllExpenses(userId, range, [vehicleId], hideFinancials),
        this.getAllVehicleUnits(userId),
      ]);
      const fuelRows = allExpenses.filter((e) => e.category === 'fuel');
      const scale = canonicalScale(this.vehicleUnitsFor(vehicleUnitsMap, vehicleId));
      return {
        maintenanceCosts: buildVehicleMaintenanceCosts(allExpenses, calendar),
        fuelEfficiencyAndCost: buildFuelEfficiencyAndCost(fuelRows, scale, calendar),
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

  async getYearEnd(userId: string, year: number, timeZone?: string): Promise<YearEndData> {
    const calendar = zonedCalendar(timeZone);
    try {
      const { start: yearStart, end: yearEnd } = calendarYearRange(year, calendar);
      const yearRange: DateRange = {
        start: Math.floor(yearStart.getTime() / 1000),
        end: Math.floor(yearEnd.getTime() / 1000),
      };
      const [vehicleNameMap, allExpenses, fuelRows, prevTotalSpent, userUnits, vehicleUnitsMap] =
        await Promise.all([
          this.queryVehicleNameMap(userId),
          this.queryAllExpenses(userId, yearRange),
          this.queryFuelExpenses(userId, yearRange),
          this.queryTotalSpending(userId, year - 1, calendar),
          this.getUserUnits(userId),
          this.getAllVehicleUnits(userId),
        ]);

      const totalSpent = allExpenses.reduce((s, e) => s + e.expenseAmount, 0);
      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits, zonedCalendar(timeZone));
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
        costPerDistance: this.costPerDistance(allExpenses, convert, fuelRows),
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

  async getSummary(
    userId: string,
    range: DateRange,
    ytdStart?: number,
    timeZone?: string,
    filter?: VehicleFilter
  ): Promise<AnalyticsSummaryData> {
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
        prevFuelRows,
        prevYearAgg,
        userUnits,
        vehicleUnitsMap,
      ] = await Promise.all([
        this.queryVehicleNameMap(userId, filter),
        this.db
          .select({
            id: vehicles.id,
          })
          .from(vehicles)
          .where(and(ownedVehiclesScope(userId), vehicleFilterCondition(vehicles.id, filter))),
        this.queryAllExpenses(userId, range, filter),
        this.queryFuelExpenses(userId, range, filter),
        this.queryFuelExpenses(userId, prevRange, filter),
        this.queryFuelAggregates(userId, prevRange, filter),
        this.getUserUnits(userId),
        this.getAllVehicleUnits(userId),
      ]);

      const fuelRowsByVehicle = sortByVehicleThenDate(fuelRows);

      const convert = this.fleetUnitConverter(vehicleUnitsMap, userUnits, zonedCalendar(timeZone));
      const avgEfficiency = this.computeAverageEfficiency(fuelRows, convert);
      const ytdSpending = yearToDateSpending(allExpenses, range, ytdStart);
      const fleetHealthScore =
        vehicleRows.length > 0
          ? await this.computeFleetHealthScore(vehicleRows, userId, timeZone)
          : 0;

      const quickStats: QuickStatsData = {
        vehicleCount: vehicleRows.length,
        ytdSpending,
        avgEfficiency,
        costPerDistance: this.costPerDistance(allExpenses, convert),
        fleetHealthScore,
        units: { ...userUnits },
      };

      const fuelStats = this.buildFuelStatsFromData(
        fuelRows,
        fuelRowsByVehicle,
        vehicleNameMap,
        range,
        prevYearAgg,
        prevFuelRows,
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
