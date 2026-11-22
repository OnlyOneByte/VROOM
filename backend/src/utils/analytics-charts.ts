import { isElectricFuelType } from '../db/types';
import {
  MAX_VALID_MI_KWH,
  MAX_VALID_MPG,
  MIN_VALID_MI_KWH,
  MIN_VALID_MPG,
  maxOf,
  minOf,
  termBillingMonths,
} from './calculations';
import { calendarDayIn, zonedMidnight } from './time-zone';
import { NATIVE_SCALE, type UnitScale } from './unit-conversions';

const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;
const EPOCH_MILLISECONDS_THRESHOLD = 1e12;
const MIN_VEHICLE_SCORE = 10;
const MAX_VEHICLE_SCORE = 100;

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

export const isFillup = (r: Pick<FuelExpenseRow, 'volume' | 'fuelType'>): boolean =>
  r.volume != null && r.volume > 0 && !isElectricFuelType(r.fuelType);

export const isChargeSession = (r: Pick<FuelExpenseRow, 'volume' | 'fuelType'>): boolean =>
  r.volume != null && r.volume > 0 && isElectricFuelType(r.fuelType);

export interface GeneralExpenseRow {
  id: string;
  vehicleId: string;
  category: string;
  description: string | null;
  expenseAmount: number;
  date: Date | number | null;
  mileage: number | null;
  volume: number | null;
  fuelType: string | null;
  missedFillup: boolean;
}

interface VehicleMetrics {
  fuelEfficiency: number | null;
  maintenanceCost: number;
  maintenanceCount: number;
  annualCost: number;
  totalMileage: number;
}

const NATIVE_UNITS: RadarUnitConverters = {
  efficiency: (value) => value,
  distance: (value) => value,
};

function scaleOf(convert: RadarUnitConverters | undefined, vehicleId: string): UnitScale {
  return convert?.scale?.(vehicleId) ?? NATIVE_SCALE;
}

function isRealisticEfficiency(efficiency: number, electric: boolean): boolean {
  if (electric) {
    return efficiency >= MIN_VALID_MI_KWH && efficiency <= MAX_VALID_MI_KWH;
  }
  return efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
}

export function computeEfficiencyPoint(
  current: FuelRow,
  previous: FuelRow,
  scale: UnitScale = NATIVE_SCALE
): FuelEfficiencyPoint | null {
  if (current.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;

  const milesDriven = current.mileage - previous.mileage;
  const miles = milesDriven * scale.distance;
  if (milesDriven <= 0 || miles > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;
  if (!current.volume || current.volume <= 0) return null;

  const efficiency = milesDriven / current.volume;
  const electric = isElectricFuelType(current.fuelType);
  const canonicalVolume = electric ? current.volume : current.volume * scale.volume;
  if (!isRealisticEfficiency(miles / canonicalVolume, electric)) return null;

  const normalized = normalizeDate(current.date);
  return {
    date: normalized ? normalized.toISOString() : '',
    efficiency,
    mileage: current.mileage,
  };
}

export function gasEfficiencyPoint(
  current: FuelRow,
  previous: FuelRow,
  scale: UnitScale = NATIVE_SCALE
): FuelEfficiencyPoint | null {
  if (isElectricFuelType(current.fuelType)) return null;
  return computeEfficiencyPoint(current, previous, scale);
}

export interface Calendar {
  day: (d: Date) => string;
  yearStart: (year: number) => Date;
}

function utcDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export const UTC_CALENDAR: Calendar = {
  day: utcDay,
  yearStart: (year) => new Date(Date.UTC(year, 0, 1)),
};

export function zonedCalendar(timeZone: string | undefined): Calendar {
  if (!timeZone) return UTC_CALENDAR;
  const days = new Map<number, string>();
  return {
    day: (d) => {
      const t = d.getTime();
      if (Number.isNaN(t)) return utcDay(d);
      let key = days.get(t);
      if (key === undefined) {
        key = calendarDayIn(d, timeZone);
        days.set(t, key);
      }
      return key;
    },
    yearStart: (year) => zonedMidnight(year, 0, 1, timeZone),
  };
}

export function calendarParts(d: Date, calendar: Calendar): { year: number; month: number } {
  const day = calendar.day(d);
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1 };
}

export function weekdayOf(d: Date, calendar: Calendar): number {
  return new Date(`${calendar.day(d)}T00:00:00Z`).getUTCDay();
}

export function toMonthKey(d: Date, calendar: Calendar = UTC_CALENDAR): string {
  return calendar.day(d).slice(0, 7);
}

export function shiftedMonthKey(d: Date, months: number, calendar: Calendar): string {
  const { year, month } = calendarParts(d, calendar);
  return toMonthKey(new Date(Date.UTC(year, month + months, 1)));
}

export function effectiveMonthlyPremium(term: {
  startDate: Date | null;
  endDate: Date | null;
  monthlyCost: number | null;
  totalCost: number | null;
}): number {
  if (term.monthlyCost != null) return term.monthlyCost;
  if (term.totalCost == null) return 0;

  if (!term.startDate || !term.endDate) return 0;
  return term.totalCost / termBillingMonths(term.startDate, term.endDate);
}

interface AmortizationLoan {
  balance: number;
  apr: number;
  paymentAmount: number;
}

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
    return new Date(d < EPOCH_MILLISECONDS_THRESHOLD ? d * 1000 : d);
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

function forEachVehiclePair<T extends { vehicleId: string }>(
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

export function* sameEnergyPairs<T extends { vehicleId: string; fuelType: string | null }>(
  rows: T[]
): Generator<[current: T, previous: T]> {
  for (const vehicleRows of groupByVehicle(rows).values()) {
    const lastByEnergy = new Map<boolean, T>();
    for (const current of vehicleRows) {
      const electric = isElectricFuelType(current.fuelType);
      const previous = lastByEnergy.get(electric);
      if (previous) yield [current, previous];
      lastByEnergy.set(electric, current);
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

export function computeMpgAndCostPerMile(
  rows: FuelExpenseRow[],
  convert: RadarUnitConverters = NATIVE_UNITS
): {
  mpgValues: number[];
  costPerMileValues: number[];
} {
  const mpgValues: number[] = [];
  const costPerMileValues: number[] = [];

  for (const [current, previous] of sameEnergyPairs(rows)) {
    const vId = current.vehicleId;
    const point = computeEfficiencyPoint(current, previous, scaleOf(convert, vId));
    if (!point) continue;

    if (!isElectricFuelType(current.fuelType)) {
      mpgValues.push(convert.efficiency(point.efficiency, vId));
    }
    const milesDriven = (current.mileage ?? 0) - (previous.mileage ?? 0);
    if (milesDriven > 0 && current.expenseAmount > 0) {
      costPerMileValues.push(current.expenseAmount / convert.distance(milesDriven, vId));
    }
  }

  return { mpgValues, costPerMileValues };
}

export function buildGasPriceHistory(
  rows: FuelExpenseRow[],
  include: (r: FuelExpenseRow) => boolean = isFillup,
  toUserVolume: (value: number, vehicleId: string) => number = (value) => value
): Array<{ date: string; fuelType: string; pricePerVolume: number }> {
  return rows
    .filter((r) => include(r) && r.expenseAmount > 0 && r.date != null)
    .map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      fuelType: r.fuelType ?? 'Regular',
      pricePerVolume: r.expenseAmount / toUserVolume(r.volume as number, r.vehicleId),
    }))
    .slice(-100);
}

export function buildFillupCostByVehicle(
  rows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>,
  calendar: Calendar = UTC_CALENDAR
): Array<{ month: string; vehicleId: string; vehicleName: string; avgCost: number }> {
  const map = new Map<string, { totalCost: number; count: number }>();
  for (const row of rows) {
    if (!isFillup(row)) continue;
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = `${toMonthKey(d, calendar)}|${row.vehicleId}`;
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

export function efficiencyRange(efficiencyValues: number[]): {
  bestEfficiency: number | null;
  worstEfficiency: number | null;
} {
  if (efficiencyValues.length === 0) return { bestEfficiency: null, worstEfficiency: null };
  return {
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

function validMilesBetween(
  current: { mileage: number | null; missedFillup: boolean },
  previous: { mileage: number | null; missedFillup: boolean },
  scale: UnitScale = NATIVE_SCALE
): number | null {
  if (current.missedFillup) return null;
  if (!current.mileage || !previous.mileage) return null;
  const miles = current.mileage - previous.mileage;
  if (miles <= 0 || miles * scale.distance > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) return null;
  return miles;
}

export function buildCostPerDistanceChart(
  rows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>,
  convert: RadarUnitConverters = NATIVE_UNITS
): Array<{ month: string; vehicleId: string; vehicleName: string; costPerDistance: number }> {
  const map = new Map<string, { totalCost: number; totalMiles: number }>();

  forEachVehiclePair(rows, (current, previous) => {
    const vId = current.vehicleId;
    const nativeMiles = validMilesBetween(current, previous, scaleOf(convert, vId));
    if (nativeMiles === null) return;
    const miles = convert.distance(nativeMiles, vId);
    const d = normalizeDate(current.date);
    if (!d) return;
    const key = `${toMonthKey(d, convert.calendar)}|${current.vehicleId}`;
    const entry = map.get(key) ?? { totalCost: 0, totalMiles: 0 };
    entry.totalCost += current.expenseAmount;
    entry.totalMiles += miles;
    map.set(key, entry);
  });

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
  now: Date,
  vehicleNameMap: Map<string, string>
): Array<{
  vehicleId: string;
  vehicleName: string;
  service: string;
  lastServiceDate: string;
  nextDueDate: string;
  daysRemaining: number;
  status: 'good' | 'warning' | 'overdue';
}> {
  const serviceGroups = new Map<
    string,
    { vehicleId: string; service: string; rows: GeneralExpenseRow[] }
  >();
  for (const row of maintenanceRows) {
    const service = (row.description ?? 'general maintenance').toLowerCase().trim();
    const key = `${row.vehicleId}|${service}`;
    const group = serviceGroups.get(key) ?? { vehicleId: row.vehicleId, service, rows: [] };
    group.rows.push(row);
    serviceGroups.set(key, group);
  }

  const timeline: ReturnType<typeof buildMaintenanceTimeline> = [];
  for (const { vehicleId, service, rows } of serviceGroups.values()) {
    const entry = buildTimelineEntry(service, rows, now);
    if (entry) {
      timeline.push({
        vehicleId,
        vehicleName: vehicleNameMap.get(vehicleId) ?? 'Unknown',
        ...entry,
      });
    }
  }

  return timeline.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 50);
}

function normalizeScore(value: number, min: number, max: number, invert: boolean): number {
  if (max === min) return 50;
  const ratio = (value - min) / (max - min);
  const score = invert ? 1 - ratio : ratio;
  const scaled = MIN_VEHICLE_SCORE + score * (MAX_VEHICLE_SCORE - MIN_VEHICLE_SCORE);
  return Math.max(MIN_VEHICLE_SCORE, Math.min(MAX_VEHICLE_SCORE, Math.round(scaled)));
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
  metrics: Map<string, VehicleMetrics>,
  convert?: RadarUnitConverters
): void {
  const totals = new Map<string, { miles: number; volume: number }>();
  for (const [current, previous] of sameEnergyPairs(fuelRows)) {
    const point = gasEfficiencyPoint(current, previous, scaleOf(convert, current.vehicleId));
    if (!point) continue;
    const entry = totals.get(current.vehicleId) ?? { miles: 0, volume: 0 };
    entry.miles += (current.mileage as number) - (previous.mileage as number);
    entry.volume += current.volume as number;
    totals.set(current.vehicleId, entry);
  }
  for (const [vId, { miles, volume }] of totals) {
    const m = metrics.get(vId);
    if (m) m.fuelEfficiency = miles / volume;
  }
}

export interface RadarUnitConverters {
  efficiency: (value: number, vehicleId: string) => number;
  distance: (value: number, vehicleId: string) => number;
  scale?: (vehicleId: string) => UnitScale;
  calendar?: Calendar;
}

export function buildVehicleRadar(
  allExpenses: GeneralExpenseRow[],
  fuelRows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>,
  convert?: RadarUnitConverters
): Array<{
  vehicleId: string;
  vehicleName: string;
  fuelEfficiency: number | null;
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
      fuelEfficiency: null,
      maintenanceCost: 0,
      maintenanceCount: 0,
      annualCost: 0,
      totalMileage: 0,
    });
  }

  accumulateExpenseMetrics(allExpenses, metrics);
  computePerVehicleFuelEfficiency(fuelRows, metrics, convert);

  if (convert) {
    for (const [vId, m] of metrics) {
      if (m.fuelEfficiency != null) m.fuelEfficiency = convert.efficiency(m.fuelEfficiency, vId);
      if (m.totalMileage > 0) m.totalMileage = convert.distance(m.totalMileage, vId);
    }
  }

  const raw = vehicleIds.map((vId) => {
    const m = metrics.get(vId);
    return (
      m ?? {
        fuelEfficiency: null,
        maintenanceCost: 0,
        maintenanceCount: 0,
        annualCost: 0,
        totalMileage: 0,
      }
    );
  });
  const fuelEffVals = raw.flatMap((m) => (m.fuelEfficiency == null ? [] : [m.fuelEfficiency]));
  const maintCostVals = raw.map((m) => m.maintenanceCost);
  const reliabilityVals = raw.map((m) => m.maintenanceCount);
  const annualCostVals = raw.map((m) => m.annualCost);
  const mileageVals = raw.map((m) => m.totalMileage);

  return vehicleIds.map((vId) => {
    const m = metrics.get(vId) ?? raw[0];
    return {
      vehicleId: vId,
      vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
      fuelEfficiency:
        m.fuelEfficiency == null
          ? null
          : normalizeScore(m.fuelEfficiency, minOf(fuelEffVals), maxOf(fuelEffVals), false),
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

export function buildMonthlyCostHeatmap(
  allExpenses: GeneralExpenseRow[],
  calendar: Calendar = UTC_CALENDAR
): Array<{
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
    const key = toMonthKey(d, calendar);
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
  fuelRows: FuelExpenseRow[],
  buckets: Array<{ label: string; min: number; max: number; count: number }>
): void {
  for (const [current, previous] of sameEnergyPairs(sortByVehicleThenDate(fuelRows))) {
    const curr = normalizeDate(current.date);
    const prev = normalizeDate(previous.date);
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
  const buckets = [
    { label: '1-3 days', min: 1, max: 3, count: 0 },
    { label: '4-7 days', min: 4, max: 7, count: 0 },
    { label: '8-14 days', min: 8, max: 14, count: 0 },
    { label: '15-21 days', min: 15, max: 21, count: 0 },
    { label: '22+ days', min: 22, max: Number.POSITIVE_INFINITY, count: 0 },
  ];

  accumulateIntervalBuckets(
    fuelRows.filter((row) => row.date != null),
    buckets
  );

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
  }>,
  calendar: Calendar = UTC_CALENDAR
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
    const key = toMonthKey(d, calendar);
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
  allExpenses: GeneralExpenseRow[],
  calendar: Calendar = UTC_CALENDAR
): Array<{ month: string; cost: number }> {
  const map = new Map<string, number>();
  for (const row of allExpenses) {
    if (row.category !== 'maintenance') continue;
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d, calendar);
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
  prevRow: GeneralExpenseRow | undefined,
  scale: UnitScale,
  calendar: Calendar
): void {
  const d = normalizeDate(row.date);
  if (!d) return;
  const key = toMonthKey(d, calendar);
  const entry = monthData.get(key) ?? { totalCost: 0, totalGallons: 0, totalMiles: 0, count: 0 };
  entry.totalCost += row.expenseAmount;

  const miles = prevRow ? validMilesBetween(row, prevRow, scale) : null;
  if (miles !== null && row.volume != null && row.volume > 0) {
    entry.totalMiles += miles;
    entry.totalGallons += row.volume;
  }
  entry.count++;
  monthData.set(key, entry);
}

export function buildFuelEfficiencyAndCost(
  fuelRows: GeneralExpenseRow[],
  scale: UnitScale = NATIVE_SCALE,
  calendar: Calendar = UTC_CALENDAR
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

  let previousFillup: GeneralExpenseRow | undefined;
  for (const row of sorted) {
    if (isElectricFuelType(row.fuelType)) {
      accumulateFuelRow(monthData, row, undefined, scale, calendar);
      continue;
    }
    accumulateFuelRow(monthData, row, previousFillup, scale, calendar);
    previousFillup = row;
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
  allExpenses: GeneralExpenseRow[],
  calendar: Calendar = UTC_CALENDAR
): Array<{ month: string; amount: number }> {
  const map = new Map<string, number>();
  for (const row of allExpenses) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    const key = toMonthKey(d, calendar);
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
