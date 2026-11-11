import { isElectricFuelType } from '../db/types';
import {
  MAX_VALID_MI_KWH,
  MAX_VALID_MPG,
  MIN_VALID_MI_KWH,
  MIN_VALID_MPG,
  maxOf,
  minOf,
} from './calculations';

const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const SEASON_MAP: Record<number, string> = {
  0: 'Winter',
  1: 'Winter',
  2: 'Spring',
  3: 'Spring',
  4: 'Spring',
  5: 'Summer',
  6: 'Summer',
  7: 'Summer',
  8: 'Fall',
  9: 'Fall',
  10: 'Fall',
  11: 'Winter',
};

const VALID_CATEGORIES = [
  'fuel',
  'maintenance',
  'financial',
  'regulatory',
  'enhancement',
  'misc',
] as const;

export interface FuelEfficiencyPoint {
  date: string;
  efficiency: number;
  mileage: number;
}

export interface FuelRow {
  date: Date | number | null;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  missedFillup: boolean;
}

export interface FuelExpenseRow {
  date: Date | number | null;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  missedFillup: boolean;
  expenseAmount: number;
  vehicleId: string;
}

// A split fuel expense creates one sibling per vehicle with volume=null, so only volume-bearing
// rows are fillups.
export const isFillup = (r: Pick<FuelExpenseRow, 'volume'>): boolean =>
  r.volume != null && r.volume > 0;

export interface GeneralExpenseRow {
  id: string;
  vehicleId: string;
  category: string;
  description: string | null;
  expenseAmount: number;
  date: Date | number | null;
  mileage: number | null;
  volume: number | null;
  missedFillup: boolean;
}

interface VehicleMetrics {
  fuelEfficiency: number;
  maintenanceCost: number;
  maintenanceCount: number;
  annualCost: number;
  totalMileage: number;
}

function isRealisticEfficiency(efficiency: number, electric: boolean): boolean {
  if (electric) {
    return efficiency >= MIN_VALID_MI_KWH && efficiency <= MAX_VALID_MI_KWH;
  }
  return efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
}

export function computeEfficiencyPoint(
  current: FuelRow,
  previous: FuelRow
): FuelEfficiencyPoint | null {
  if (current.missedFillup || previous.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;

  const milesDriven = current.mileage - previous.mileage;
  if (milesDriven <= 0 || milesDriven > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;
  if (!current.volume || current.volume <= 0) return null;

  const efficiency = milesDriven / current.volume;
  if (!isRealisticEfficiency(efficiency, isElectricFuelType(current.fuelType))) return null;

  const normalized = normalizeDate(current.date);
  return {
    date: normalized ? normalized.toISOString() : '',
    efficiency,
    mileage: current.mileage,
  };
}

// Charge sessions store kWh in volume, so their mi/kWh must not feed a mi/gal average.
export function gasEfficiencyPoint(
  current: FuelRow,
  previous: FuelRow
): FuelEfficiencyPoint | null {
  if (isElectricFuelType(current.fuelType)) return null;
  return computeEfficiencyPoint(current, previous);
}

export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The cursor is pinned to day 1: stepping a day 29-31 date with setMonth skips short months.
export function monthKeysInRange(start: Date | null, end: Date | null): string[] {
  if (!start || !end) return [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  const keys: string[] = [];
  while (cursor <= last) {
    keys.push(toMonthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

// Ignoring totalCost when monthlyCost is null would zero out every lump-sum term.
export function effectiveMonthlyPremium(term: {
  startDate: Date | null;
  endDate: Date | null;
  monthlyCost: number | null;
  totalCost: number | null;
}): number {
  if (term.monthlyCost != null) return term.monthlyCost;
  if (term.totalCost == null) return 0;

  const monthsInTerm = monthKeysInRange(term.startDate, term.endDate).length;
  if (monthsInTerm === 0) return 0;
  return term.totalCost / monthsInTerm;
}

export interface AmortizationLoan {
  balance: number;
  apr: number;
  paymentAmount: number;
}

// Interest accrues on the running balance, so it declines as principal is repaid.
export function buildAmortizationSchedule(
  loans: AmortizationLoan[],
  monthKeys: string[]
): Array<{ month: string; interest: number; principal: number }> {
  const balances = loans.map((l) => l.balance);

  return monthKeys.map((month) => {
    let totalInterest = 0;
    let totalPrincipal = 0;
    for (let i = 0; i < loans.length; i++) {
      const balance = balances[i];
      if (balance <= 0) continue;
      const interest = balance * (loans[i].apr / 100 / 12);
      // The final payment is smaller than paymentAmount, so principal is capped at the balance.
      const principal = Math.min(Math.max(0, loans[i].paymentAmount - interest), balance);
      totalInterest += Math.max(0, interest);
      totalPrincipal += principal;
      balances[i] = balance - principal;
    }
    return { month, interest: totalInterest, principal: totalPrincipal };
  });
}

export function normalizeDate(d: Date | number | null): Date | null {
  if (d == null) return null;
  if (d instanceof Date) return d;
  if (typeof d === 'number') {
    // Seconds below 1e12, milliseconds above.
    return new Date(d < 1e12 ? d * 1000 : d);
  }
  return new Date(d);
}

export function groupByVehicle<T extends { vehicleId: string }>(rows: T[]): Map<string, T[]> {
  const byVehicle = new Map<string, T[]>();
  for (const row of rows) {
    const arr = byVehicle.get(row.vehicleId) ?? [];
    arr.push(row);
    byVehicle.set(row.vehicleId, arr);
  }
  return byVehicle;
}

// Pairing is per vehicle so two cars' odometer readings are never subtracted from each other.
export function forEachVehiclePair<T extends { vehicleId: string }>(
  rows: T[],
  callback: (current: T, previous: T) => void
): void {
  for (const vehicleRows of groupByVehicle(rows).values()) {
    for (let i = 1; i < vehicleRows.length; i++) {
      const current = vehicleRows[i];
      const previous = vehicleRows[i - 1];
      if (!current || !previous) continue;
      callback(current, previous);
    }
  }
}

export function sortByVehicleThenDate<T extends { vehicleId: string; date: Date | number | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    if (a.vehicleId !== b.vehicleId) return a.vehicleId.localeCompare(b.vehicleId);
    const aTime = a.date instanceof Date ? a.date.getTime() : Number(a.date);
    const bTime = b.date instanceof Date ? b.date.getTime() : Number(b.date);
    return aTime - bTime;
  });
}

export function computeMpgAndCostPerMile(rows: FuelExpenseRow[]): {
  mpgValues: number[];
  costPerMileValues: number[];
} {
  const mpgValues: number[] = [];
  const costPerMileValues: number[] = [];

  forEachVehiclePair(rows, (current, previous) => {
    const point = computeEfficiencyPoint(current, previous);
    if (!point) return;

    // Only gas pairs count toward MPG; cost per mile spans all energy, so it is not filtered.
    if (gasEfficiencyPoint(current, previous)) {
      mpgValues.push(point.efficiency);
    }
    const milesDriven = (current.mileage ?? 0) - (previous.mileage ?? 0);
    if (milesDriven > 0 && current.expenseAmount > 0) {
      costPerMileValues.push(current.expenseAmount / milesDriven);
    }
  });

  return { mpgValues, costPerMileValues };
}

export function buildMonthlyConsumption(
  rows: FuelExpenseRow[]
): Array<{ month: string; efficiency: number; volume: number }> {
  const map = new Map<string, { effSum: number; effCount: number; volume: number }>();

  for (const row of rows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d);
    const entry = map.get(key) ?? { effSum: 0, effCount: 0, volume: 0 };
    entry.volume += row.volume ?? 0;
    map.set(key, entry);
  }

  forEachVehiclePair(rows, (current, previous) => {
    const point = gasEfficiencyPoint(current, previous);
    if (!point) return;
    const key = toMonthKey(new Date(point.date));
    const entry = map.get(key);
    if (entry) {
      entry.effSum += point.efficiency;
      entry.effCount++;
    }
  });

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, data]) => ({
      month,
      efficiency: data.effCount > 0 ? data.effSum / data.effCount : 0,
      volume: data.volume,
    }));
}

export function buildGasPriceHistory(
  rows: FuelExpenseRow[]
): Array<{ date: string; fuelType: string; pricePerVolume: number }> {
  return rows
    .filter((r) => r.volume != null && r.volume > 0 && r.expenseAmount > 0 && r.date != null)
    .map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      fuelType: r.fuelType ?? 'Regular',
      pricePerVolume: r.expenseAmount / (r.volume as number),
    }))
    .slice(-100);
}

export function buildFillupCostByVehicle(
  rows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>
): Array<{ month: string; vehicleId: string; vehicleName: string; avgCost: number }> {
  const map = new Map<string, { totalCost: number; count: number }>();
  for (const row of rows) {
    if (!isFillup(row)) continue;
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = `${toMonthKey(d)}|${row.vehicleId}`;
    const entry = map.get(key) ?? { totalCost: 0, count: 0 };
    entry.totalCost += row.expenseAmount;
    entry.count++;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, data]) => {
      const [month, vId] = key.split('|') as [string, string];
      return {
        month,
        vehicleId: vId,
        vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
        avgCost: data.count > 0 ? data.totalCost / data.count : 0,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-120);
}

export function computeFuelConsumptionMetrics(efficiencyValues: number[]): {
  avgEfficiency: number | null;
  bestEfficiency: number | null;
  worstEfficiency: number | null;
} {
  if (efficiencyValues.length === 0)
    return { avgEfficiency: null, bestEfficiency: null, worstEfficiency: null };
  return {
    avgEfficiency: efficiencyValues.reduce((a, b) => a + b, 0) / efficiencyValues.length,
    bestEfficiency: maxOf(efficiencyValues),
    worstEfficiency: minOf(efficiencyValues),
  };
}

export function computeAverageCosts(
  fuelRows: FuelExpenseRow[],
  costPerMileValues: number[],
  yearStart: Date,
  yearEnd: Date,
  now: Date
): {
  perFillup: number | null;
  bestCostPerDistance: number | null;
  worstCostPerDistance: number | null;
  avgCostPerDay: number | null;
} {
  const withCost = fuelRows.filter((r) => r.expenseAmount > 0);
  // Numerator and denominator must share the same row basis, or split-fuel siblings skew the
  // average.
  const fillups = fuelRows.filter(isFillup);
  const perFillup =
    fillups.length > 0 ? fillups.reduce((s, r) => s + r.expenseAmount, 0) / fillups.length : null;
  const daysSoFar = Math.max(
    1,
    Math.ceil((Math.min(now.getTime(), yearEnd.getTime()) - yearStart.getTime()) / 86400000)
  );
  const totalSpending = withCost.reduce((s, r) => s + r.expenseAmount, 0);
  return {
    perFillup,
    bestCostPerDistance: costPerMileValues.length > 0 ? minOf(costPerMileValues) : null,
    worstCostPerDistance: costPerMileValues.length > 0 ? maxOf(costPerMileValues) : null,
    avgCostPerDay: withCost.length > 0 ? totalSpending / daysSoFar : null,
  };
}

// Returns null for a window spanning a missed fill-up, a non-positive delta, or an implausibly
// large gap.
function validMilesBetween(
  current: { mileage: number | null; missedFillup: boolean },
  previous: { mileage: number | null; missedFillup: boolean }
): number | null {
  if (current.missedFillup || previous.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;
  const miles = current.mileage - previous.mileage;
  if (miles <= 0 || miles > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;
  return miles;
}

function accumulateCostPerMile(
  vehicleRows: FuelExpenseRow[],
  map: Map<string, { totalCost: number; totalMiles: number }>
): void {
  for (let i = 1; i < vehicleRows.length; i++) {
    const current = vehicleRows[i];
    const previous = vehicleRows[i - 1];
    if (!current || !previous) continue;
    const miles = validMilesBetween(current, previous);
    if (miles === null) continue;
    const d = normalizeDate(current.date);
    if (!d) continue;
    const key = `${toMonthKey(d)}|${current.vehicleId}`;
    const entry = map.get(key) ?? { totalCost: 0, totalMiles: 0 };
    entry.totalCost += current.expenseAmount;
    entry.totalMiles += miles;
    map.set(key, entry);
  }
}

export function buildCostPerDistanceChart(
  rows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>
): Array<{ month: string; vehicleId: string; vehicleName: string; costPerDistance: number }> {
  const map = new Map<string, { totalCost: number; totalMiles: number }>();

  for (const vehicleRows of groupByVehicle(rows).values()) {
    accumulateCostPerMile(vehicleRows, map);
  }

  return Array.from(map.entries())
    .filter(([, data]) => data.totalMiles > 0)
    .map(([key, data]) => {
      const [month, vId] = key.split('|') as [string, string];
      return {
        month,
        vehicleId: vId,
        vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
        costPerDistance: data.totalCost / data.totalMiles,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-120);
}

function assignTimelineStatus(daysRemaining: number): 'good' | 'warning' | 'overdue' {
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining < 30) return 'warning';
  return 'good';
}

function estimateServiceInterval(sorted: GeneralExpenseRow[]): number {
  if (sorted.length < 2) return 180;
  const intervals: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = normalizeDate(sorted[i]?.date ?? null);
    const prev = normalizeDate(sorted[i + 1]?.date ?? null);
    if (!curr || !prev) continue;
    const days = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0) intervals.push(days);
  }
  if (intervals.length === 0) return 180;
  return Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
}

function buildTimelineEntry(
  service: string,
  rows: GeneralExpenseRow[],
  now: Date
): {
  service: string;
  lastServiceDate: string;
  nextDueDate: string;
  daysRemaining: number;
  status: 'good' | 'warning' | 'overdue';
} | null {
  const sorted = rows
    .filter((r) => r.date != null)
    .sort((a, b) => {
      const da = normalizeDate(b.date);
      const db = normalizeDate(a.date);
      return (da?.getTime() ?? 0) - (db?.getTime() ?? 0);
    });
  if (sorted.length === 0) return null;

  const lastDate = normalizeDate((sorted[0] as GeneralExpenseRow).date) as Date;
  const intervalDays = estimateServiceInterval(sorted);
  const nextDueDate = new Date(lastDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  const daysRemaining = Math.round((nextDueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    service,
    lastServiceDate: lastDate.toISOString(),
    nextDueDate: nextDueDate.toISOString(),
    daysRemaining,
    status: assignTimelineStatus(daysRemaining),
  };
}

export function buildMaintenanceTimeline(
  maintenanceRows: GeneralExpenseRow[],
  now: Date
): Array<{
  service: string;
  lastServiceDate: string;
  nextDueDate: string;
  daysRemaining: number;
  status: 'good' | 'warning' | 'overdue';
}> {
  const serviceGroups = new Map<string, GeneralExpenseRow[]>();
  for (const row of maintenanceRows) {
    const key = (row.description ?? 'general maintenance').toLowerCase().trim();
    const group = serviceGroups.get(key) ?? [];
    group.push(row);
    serviceGroups.set(key, group);
  }

  const timeline: Array<{
    service: string;
    lastServiceDate: string;
    nextDueDate: string;
    daysRemaining: number;
    status: 'good' | 'warning' | 'overdue';
  }> = [];
  for (const [service, rows] of serviceGroups) {
    if (rows.length === 0) continue;
    const entry = buildTimelineEntry(service, rows, now);
    if (entry) timeline.push(entry);
  }

  return timeline.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 50);
}

function addSeasonalEfficiencyData(
  fuelRows: FuelExpenseRow[],
  seasonData: Map<string, { effSum: number; effCount: number; fillupCount: number }>
): void {
  for (const vehicleRows of groupByVehicle(fuelRows).values()) {
    for (let i = 1; i < vehicleRows.length; i++) {
      const current = vehicleRows[i];
      const previous = vehicleRows[i - 1];
      if (!current || !previous) continue;
      const point = gasEfficiencyPoint(current, previous);
      if (!point) continue;
      const d = new Date(point.date);
      const season = SEASON_MAP[d.getMonth()] ?? 'Winter';
      const entry = seasonData.get(season);
      if (entry) {
        entry.effSum += point.efficiency;
        entry.effCount++;
      }
    }
  }
}

export function buildSeasonalEfficiency(
  fuelRows: FuelExpenseRow[]
): Array<{ season: string; avgEfficiency: number; fillupCount: number }> {
  const seasonData = new Map<string, { effSum: number; effCount: number; fillupCount: number }>();

  for (const row of fuelRows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    if (!isFillup(row)) continue;
    const season = SEASON_MAP[d.getMonth()] ?? 'Winter';
    const entry = seasonData.get(season) ?? { effSum: 0, effCount: 0, fillupCount: 0 };
    entry.fillupCount++;
    seasonData.set(season, entry);
  }

  addSeasonalEfficiencyData(fuelRows, seasonData);

  return ['Winter', 'Spring', 'Summer', 'Fall'].map((season) => {
    const data = seasonData.get(season);
    return {
      season,
      avgEfficiency: data && data.effCount > 0 ? data.effSum / data.effCount : 0,
      fillupCount: data?.fillupCount ?? 0,
    };
  });
}

function normalizeScore(value: number, min: number, max: number, invert: boolean): number {
  if (max === min) return 50;
  const ratio = (value - min) / (max - min);
  const score = invert ? 1 - ratio : ratio;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

function accumulateExpenseMetrics(
  allExpenses: GeneralExpenseRow[],
  metrics: Map<string, VehicleMetrics>
): void {
  for (const row of allExpenses) {
    const m = metrics.get(row.vehicleId);
    if (!m) continue;
    m.annualCost += row.expenseAmount;
    if (row.category === 'maintenance') {
      m.maintenanceCost += row.expenseAmount;
      m.maintenanceCount++;
    }
    if (row.mileage != null && row.mileage > m.totalMileage) {
      m.totalMileage = row.mileage;
    }
  }
}

function computePerVehicleFuelEfficiency(
  fuelRows: FuelExpenseRow[],
  metrics: Map<string, VehicleMetrics>
): void {
  const vFuelRows = new Map<string, FuelExpenseRow[]>();
  for (const row of fuelRows) {
    const arr = vFuelRows.get(row.vehicleId) ?? [];
    arr.push(row);
    vFuelRows.set(row.vehicleId, arr);
  }
  for (const [vId, rows] of vFuelRows) {
    const mpgValues: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const point = gasEfficiencyPoint(rows[i] as FuelRow, rows[i - 1] as FuelRow);
      if (point) mpgValues.push(point.efficiency);
    }
    const m = metrics.get(vId);
    if (m && mpgValues.length > 0) {
      m.fuelEfficiency = mpgValues.reduce((a, b) => a + b, 0) / mpgValues.length;
    }
  }
}

// Only fuelEfficiency and mileage carry units; costs and the reliability count do not.
export interface RadarUnitConverters {
  efficiency: (value: number, vehicleId: string) => number;
  distance: (value: number, vehicleId: string) => number;
}

export function buildVehicleRadar(
  allExpenses: GeneralExpenseRow[],
  fuelRows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>,
  convert?: RadarUnitConverters
): Array<{
  vehicleId: string;
  vehicleName: string;
  fuelEfficiency: number;
  maintenanceCost: number;
  reliability: number;
  annualCost: number;
  mileage: number;
}> {
  const vehicleIds = [...vehicleNameMap.keys()];
  if (vehicleIds.length === 0) return [];

  const metrics = new Map<string, VehicleMetrics>();
  for (const vId of vehicleIds) {
    metrics.set(vId, {
      fuelEfficiency: 0,
      maintenanceCost: 0,
      maintenanceCount: 0,
      annualCost: 0,
      totalMileage: 0,
    });
  }

  accumulateExpenseMetrics(allExpenses, metrics);
  computePerVehicleFuelEfficiency(fuelRows, metrics);

  // Convert before the cross-fleet min/max normalization, or mixed-unit fleets rank unlike values.
  if (convert) {
    for (const [vId, m] of metrics) {
      if (m.fuelEfficiency > 0) m.fuelEfficiency = convert.efficiency(m.fuelEfficiency, vId);
      if (m.totalMileage > 0) m.totalMileage = convert.distance(m.totalMileage, vId);
    }
  }

  const raw = vehicleIds.map((vId) => {
    const m = metrics.get(vId);
    return (
      m ?? {
        fuelEfficiency: 0,
        maintenanceCost: 0,
        maintenanceCount: 0,
        annualCost: 0,
        totalMileage: 0,
      }
    );
  });
  const fuelEffVals = raw.map((m) => m.fuelEfficiency);
  const maintCostVals = raw.map((m) => m.maintenanceCost);
  const reliabilityVals = raw.map((m) => m.maintenanceCount);
  const annualCostVals = raw.map((m) => m.annualCost);
  const mileageVals = raw.map((m) => m.totalMileage);

  return vehicleIds.map((vId) => {
    const m = metrics.get(vId) ?? raw[0];
    return {
      vehicleId: vId,
      vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
      fuelEfficiency: normalizeScore(
        m.fuelEfficiency,
        minOf(fuelEffVals),
        maxOf(fuelEffVals),
        false
      ),
      maintenanceCost: normalizeScore(
        m.maintenanceCost,
        minOf(maintCostVals),
        maxOf(maintCostVals),
        true
      ),
      reliability: normalizeScore(
        m.maintenanceCount,
        minOf(reliabilityVals),
        maxOf(reliabilityVals),
        true
      ),
      annualCost: normalizeScore(m.annualCost, minOf(annualCostVals), maxOf(annualCostVals), true),
      mileage: normalizeScore(m.totalMileage, minOf(mileageVals), maxOf(mileageVals), false),
    };
  });
}

export function buildDayOfWeekPatterns(
  fuelRows: FuelExpenseRow[]
): Array<{ day: string; fillupCount: number; avgCost: number; avgVolume: number }> {
  const dayData = new Map<string, { count: number; totalCost: number; totalGallons: number }>();

  for (const row of fuelRows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    if (!isFillup(row)) continue;
    const dayName = DAY_NAMES[d.getDay()] ?? 'Sunday';
    const entry = dayData.get(dayName) ?? { count: 0, totalCost: 0, totalGallons: 0 };
    entry.count++;
    entry.totalCost += row.expenseAmount;
    entry.totalGallons += row.volume ?? 0;
    dayData.set(dayName, entry);
  }

  return [...DAY_NAMES].map((day) => {
    const data = dayData.get(day);
    return {
      day,
      fillupCount: data?.count ?? 0,
      avgCost: data && data.count > 0 ? data.totalCost / data.count : 0,
      avgVolume: data && data.count > 0 ? data.totalGallons / data.count : 0,
    };
  });
}

export function buildMonthlyCostHeatmap(allExpenses: GeneralExpenseRow[]): Array<{
  month: string;
  fuel: number;
  maintenance: number;
  financial: number;
  regulatory: number;
  enhancement: number;
  misc: number;
}> {
  const monthMap = new Map<
    string,
    {
      fuel: number;
      maintenance: number;
      financial: number;
      regulatory: number;
      enhancement: number;
      misc: number;
    }
  >();

  for (const row of allExpenses) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d);
    const entry = monthMap.get(key) ?? {
      fuel: 0,
      maintenance: 0,
      financial: 0,
      regulatory: 0,
      enhancement: 0,
      misc: 0,
    };
    const cat = VALID_CATEGORIES.includes(row.category as (typeof VALID_CATEGORIES)[number])
      ? (row.category as keyof typeof entry)
      : 'misc';
    entry[cat] += row.expenseAmount;
    monthMap.set(key, entry);
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([month, data]) => ({ month, ...data }));
}

function accumulateIntervalBuckets(
  vehicleRows: FuelExpenseRow[],
  buckets: Array<{ label: string; min: number; max: number; count: number }>
): void {
  // Sort a copy so the caller's array keeps its order.
  const sorted = [...vehicleRows].sort((a, b) => {
    const da = normalizeDate(a.date);
    const db = normalizeDate(b.date);
    return (da?.getTime() ?? 0) - (db?.getTime() ?? 0);
  });
  for (let i = 1; i < sorted.length; i++) {
    const curr = normalizeDate(sorted[i]?.date ?? null);
    const prev = normalizeDate(sorted[i - 1]?.date ?? null);
    if (!curr || !prev) continue;
    const days = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) continue;
    const bucket = buckets.find((b) => days >= b.min && days <= b.max);
    if (bucket) bucket.count++;
  }
}

export function buildFillupIntervals(
  fuelRows: FuelExpenseRow[]
): Array<{ intervalLabel: string; count: number }> {
  const byVehicle = new Map<string, FuelExpenseRow[]>();
  for (const row of fuelRows) {
    if (row.date == null) continue;
    const arr = byVehicle.get(row.vehicleId) ?? [];
    arr.push(row);
    byVehicle.set(row.vehicleId, arr);
  }

  const buckets = [
    { label: '1-3 days', min: 1, max: 3, count: 0 },
    { label: '4-7 days', min: 4, max: 7, count: 0 },
    { label: '8-14 days', min: 8, max: 14, count: 0 },
    { label: '15-21 days', min: 15, max: 21, count: 0 },
    { label: '22+ days', min: 22, max: Number.POSITIVE_INFINITY, count: 0 },
  ];

  for (const vehicleRows of byVehicle.values()) {
    accumulateIntervalBuckets(vehicleRows, buckets);
  }

  return buckets
    .filter((b) => b.count > 0)
    .map((b) => ({ intervalLabel: b.label, count: b.count }));
}

export function computeRegularityScore(
  maintenanceDates: Array<{ date: Date | number | null }>
): number {
  if (maintenanceDates.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < maintenanceDates.length; i++) {
      const current = normalizeDate(maintenanceDates[i]?.date ?? null);
      const previous = normalizeDate(maintenanceDates[i - 1]?.date ?? null);
      if (!current || !previous) continue;
      const daysBetween = (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);
      gaps.push(daysBetween);
    }
    if (gaps.length > 0) {
      const overdueGaps = gaps.filter((g) => g > 90);
      return Math.max(0, Math.round(100 - (overdueGaps.length / gaps.length) * 100));
    }
    return 50;
  }
  return maintenanceDates.length === 1 ? 75 : 50;
}

export function computeMileageScore(mileageExpenses: Array<{ mileage: number | null }>): number {
  if (mileageExpenses.length < 2) return 50;
  const mileageGaps: number[] = [];
  for (let i = 1; i < mileageExpenses.length; i++) {
    const current = mileageExpenses[i];
    const previous = mileageExpenses[i - 1];
    if (current?.mileage == null || previous?.mileage == null) continue;
    mileageGaps.push(current.mileage - previous.mileage);
  }
  if (mileageGaps.length === 0) return 50;
  const goodIntervals = mileageGaps.filter((g) => g >= 3000 && g <= 7000);
  return Math.round((goodIntervals.length / mileageGaps.length) * 100);
}

export function buildTCOMonthlyTrend(
  rows: Array<{
    category: string;
    expenseAmount: number;
    date: Date | number | null;
    sourceType: string | null;
  }>
): Array<{
  month: string;
  financing: number;
  insurance: number;
  fuel: number;
  maintenance: number;
}> {
  const map = new Map<
    string,
    { financing: number; insurance: number; fuel: number; maintenance: number }
  >();
  for (const row of rows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d);
    const entry = map.get(key) ?? { financing: 0, insurance: 0, fuel: 0, maintenance: 0 };
    if (row.category === 'financial' && row.sourceType === 'financing') {
      entry.financing += row.expenseAmount;
    } else if (row.category === 'financial' && row.sourceType === 'insurance_term') {
      entry.insurance += row.expenseAmount;
    } else if (row.category === 'fuel') {
      entry.fuel += row.expenseAmount;
    } else if (row.category === 'maintenance') {
      entry.maintenance += row.expenseAmount;
    }
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data }));
}

export function buildVehicleMaintenanceCosts(
  allExpenses: GeneralExpenseRow[]
): Array<{ month: string; cost: number }> {
  const map = new Map<string, number>();
  for (const row of allExpenses) {
    if (row.category !== 'maintenance') continue;
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d);
    map.set(key, (map.get(key) ?? 0) + row.expenseAmount);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cost]) => ({ month, cost }));
}

function accumulateFuelRow(
  monthData: Map<
    string,
    { totalCost: number; totalGallons: number; totalMiles: number; count: number }
  >,
  row: GeneralExpenseRow,
  prevRow: GeneralExpenseRow | undefined
): void {
  const d = normalizeDate(row.date);
  if (!d) return;
  const key = toMonthKey(d);
  const entry = monthData.get(key) ?? { totalCost: 0, totalGallons: 0, totalMiles: 0, count: 0 };
  entry.totalCost += row.expenseAmount;

  // A volume is only paired with miles from a valid window, or one tank's fuel gets divided by two
  // tanks' miles.
  const miles = prevRow ? validMilesBetween(row, prevRow) : null;
  if (miles !== null && row.volume != null && row.volume > 0) {
    entry.totalMiles += miles;
    entry.totalGallons += row.volume;
  }
  entry.count++;
  monthData.set(key, entry);
}

export function buildFuelEfficiencyAndCost(
  fuelRows: GeneralExpenseRow[]
): Array<{ month: string; efficiency: number | null; cost: number }> {
  const monthData = new Map<
    string,
    { totalCost: number; totalGallons: number; totalMiles: number; count: number }
  >();

  const sorted = [...fuelRows].sort((a, b) => {
    const da = normalizeDate(a.date);
    const db = normalizeDate(b.date);
    if (!da || !db) return 0;
    return da.getTime() - db.getTime();
  });

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (!row) continue;
    accumulateFuelRow(monthData, row, i > 0 ? sorted[i - 1] : undefined);
  }

  return Array.from(monthData.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      efficiency: data.totalGallons > 0 ? data.totalMiles / data.totalGallons : null,
      cost: data.totalCost,
    }));
}

export function buildVehicleExpenseBreakdown(
  allExpenses: GeneralExpenseRow[]
): Array<{ category: string; amount: number }> {
  const map = new Map<string, number>();
  for (const row of allExpenses) {
    const cat = VALID_CATEGORIES.includes(row.category as (typeof VALID_CATEGORIES)[number])
      ? row.category
      : 'misc';
    map.set(cat, (map.get(cat) ?? 0) + row.expenseAmount);
  }
  return Array.from(map.entries()).map(([category, amount]) => ({ category, amount }));
}

export function buildMonthlyExpenseTrends(
  allExpenses: GeneralExpenseRow[]
): Array<{ month: string; amount: number }> {
  const map = new Map<string, number>();
  for (const row of allExpenses) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d);
    map.set(key, (map.get(key) ?? 0) + row.expenseAmount);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([month, amount]) => ({ month, amount }));
}

export function buildExpenseByCategory(
  allExpenses: GeneralExpenseRow[]
): Array<{ category: string; amount: number; percentage: number }> {
  const map = new Map<string, number>();
  let total = 0;
  for (const row of allExpenses) {
    const cat = VALID_CATEGORIES.includes(row.category as (typeof VALID_CATEGORIES)[number])
      ? row.category
      : 'misc';
    map.set(cat, (map.get(cat) ?? 0) + row.expenseAmount);
    total += row.expenseAmount;
  }
  if (total === 0) return [];
  return Array.from(map.entries()).map(([category, amount]) => ({
    category,
    amount,
    percentage: (amount / total) * 100,
  }));
}

export function buildFuelEfficiencyComparison(
  fuelRows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>
): Array<{
  month: string;
  vehicles: Array<{ vehicleId: string; vehicleName: string; efficiency: number }>;
}> {
  const byVehicle = new Map<string, FuelExpenseRow[]>();
  for (const row of fuelRows) {
    const arr = byVehicle.get(row.vehicleId) ?? [];
    arr.push(row);
    byVehicle.set(row.vehicleId, arr);
  }

  const monthVehicleEff = new Map<string, Map<string, { sum: number; count: number }>>();
  for (const [vId, rows] of byVehicle) {
    for (let i = 1; i < rows.length; i++) {
      const point = gasEfficiencyPoint(rows[i] as FuelRow, rows[i - 1] as FuelRow);
      if (!point) continue;
      const month = toMonthKey(new Date(point.date));
      if (!monthVehicleEff.has(month)) monthVehicleEff.set(month, new Map());
      const vehicleMap = monthVehicleEff.get(month) as Map<string, { sum: number; count: number }>;
      const entry = vehicleMap.get(vId) ?? { sum: 0, count: 0 };
      entry.sum += point.efficiency;
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

export function findBiggestExpense(
  rows: GeneralExpenseRow[]
): { description: string; amount: number; date: string } | null {
  if (rows.length === 0) return null;

  let biggest: GeneralExpenseRow | null = null;
  for (const row of rows) {
    if (!biggest || row.expenseAmount > biggest.expenseAmount) {
      biggest = row;
    }
  }
  if (!biggest) return null;

  const d = normalizeDate(biggest.date);
  return {
    description: biggest.description ?? 'No description',
    amount: biggest.expenseAmount,
    date: d ? d.toISOString() : '',
  };
}

export function computePreviousYearComparison(
  currentTotal: number,
  previousTotal: number
): { totalSpent: number; percentageChange: number } | null {
  if (previousTotal <= 0) return null;
  const percentageChange = ((currentTotal - previousTotal) / previousTotal) * 100;
  return { totalSpent: previousTotal, percentageChange };
}
