import { isElectricFuelType } from '../db/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Efficiency filter constants — must match frontend expense-helpers.ts */
const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;
const MIN_VALID_MPG = 5;
const MAX_VALID_MPG = 100;
const MIN_VALID_MI_KWH = 1;
const MAX_VALID_MI_KWH = 10;

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const SEASON_MAP: Record<number, string> = {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface GeneralExpenseRow {
  id: string;
  vehicleId: string;
  category: string;
  description: string | null;
  expenseAmount: number;
  date: Date | number | null;
  mileage: number | null;
  volume: number | null;
}

interface VehicleMetrics {
  fuelEfficiency: number;
  maintenanceCost: number;
  maintenanceCount: number;
  annualCost: number;
  totalMileage: number;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Check if an efficiency value is within realistic bounds for the fuel type. */
function isRealisticEfficiency(efficiency: number, electric: boolean): boolean {
  if (electric) {
    return efficiency >= MIN_VALID_MI_KWH && efficiency <= MAX_VALID_MI_KWH;
  }
  return efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
}

/** Try to compute an efficiency point from a consecutive pair. Returns null if invalid. */
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

/** Convert a date to a YYYY-MM month key. */
export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Normalize a date field that may be a Date or timestamp (Unix seconds). */
function normalizeDate(d: Date | number | null): Date | null {
  if (d == null) return null;
  if (d instanceof Date) return d;
  if (typeof d === 'number') {
    // Unix timestamps in seconds (< 1e12) vs milliseconds (>= 1e12)
    return new Date(d < 1e12 ? d * 1000 : d);
  }
  return new Date(d);
}

/** Group fuel expense rows by vehicleId. */
export function groupByVehicle(rows: FuelExpenseRow[]): Map<string, FuelExpenseRow[]> {
  const byVehicle = new Map<string, FuelExpenseRow[]>();
  for (const row of rows) {
    const arr = byVehicle.get(row.vehicleId) ?? [];
    arr.push(row);
    byVehicle.set(row.vehicleId, arr);
  }
  return byVehicle;
}

/** Iterate consecutive fuel pairs within each vehicle group. */
function forEachVehiclePair(
  rows: FuelExpenseRow[],
  callback: (current: FuelExpenseRow, previous: FuelExpenseRow) => void
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

/** Compute MPG and cost-per-mile values from consecutive fuel expense pairs. */
export function computeMpgAndCostPerMile(rows: FuelExpenseRow[]): {
  mpgValues: number[];
  costPerMileValues: number[];
} {
  const mpgValues: number[] = [];
  const costPerMileValues: number[] = [];

  forEachVehiclePair(rows, (current, previous) => {
    const point = computeEfficiencyPoint(current, previous);
    if (!point) return;

    mpgValues.push(point.efficiency);
    const milesDriven = (current.mileage ?? 0) - (previous.mileage ?? 0);
    if (milesDriven > 0 && current.expenseAmount > 0) {
      costPerMileValues.push(current.expenseAmount / milesDriven);
    }
  });

  return { mpgValues, costPerMileValues };
}

/** Build monthly consumption chart data from fuel rows. */
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

  // Add efficiency data from consecutive pairs within each vehicle group
  forEachVehiclePair(rows, (current, previous) => {
    const point = computeEfficiencyPoint(current, previous);
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
    .slice(0, 12)
    .map(([month, data]) => ({
      month,
      efficiency: data.effCount > 0 ? data.effSum / data.effCount : 0,
      volume: data.volume,
    }));
}

/** Build gas price history from fuel rows. */
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
    .slice(-100); // Cap to last 100 entries
}

/** Build fillup cost by vehicle chart data. */
export function buildFillupCostByVehicle(
  rows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>
): Array<{ month: string; vehicleId: string; vehicleName: string; avgCost: number }> {
  const map = new Map<string, { totalCost: number; count: number }>();
  for (const row of rows) {
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
    .slice(-120); // Cap to last 12 months of data (up to 10 vehicles)
}

/** Compute fuel consumption metrics (avg/best/worst efficiency) from efficiency values. */
export function computeFuelConsumptionMetrics(efficiencyValues: number[]): {
  avgEfficiency: number | null;
  bestEfficiency: number | null;
  worstEfficiency: number | null;
} {
  if (efficiencyValues.length === 0)
    return { avgEfficiency: null, bestEfficiency: null, worstEfficiency: null };
  return {
    avgEfficiency: efficiencyValues.reduce((a, b) => a + b, 0) / efficiencyValues.length,
    bestEfficiency: Math.max(...efficiencyValues),
    worstEfficiency: Math.min(...efficiencyValues),
  };
}

/** Compute average cost metrics from fuel rows. */
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
  const perFillup =
    withCost.length > 0
      ? withCost.reduce((s, r) => s + r.expenseAmount, 0) / withCost.length
      : null;
  const daysSoFar = Math.max(
    1,
    Math.ceil((Math.min(now.getTime(), yearEnd.getTime()) - yearStart.getTime()) / 86400000)
  );
  const totalSpending = withCost.reduce((s, r) => s + r.expenseAmount, 0);
  return {
    perFillup,
    bestCostPerDistance: costPerMileValues.length > 0 ? Math.min(...costPerMileValues) : null,
    worstCostPerDistance: costPerMileValues.length > 0 ? Math.max(...costPerMileValues) : null,
    avgCostPerDay: withCost.length > 0 ? totalSpending / daysSoFar : null,
  };
}

/** Accumulate cost-per-mile data from consecutive fuel expense pairs for a single vehicle. */
function accumulateCostPerMile(
  vehicleRows: FuelExpenseRow[],
  map: Map<string, { totalCost: number; totalMiles: number }>
): void {
  for (let i = 1; i < vehicleRows.length; i++) {
    const current = vehicleRows[i];
    const previous = vehicleRows[i - 1];
    if (!current || !previous) continue;
    if (!current.mileage || !previous.mileage) continue;
    const miles = current.mileage - previous.mileage;
    if (miles <= 0) continue;
    const d = normalizeDate(current.date);
    if (!d) continue;
    const key = `${toMonthKey(d)}|${current.vehicleId}`;
    const entry = map.get(key) ?? { totalCost: 0, totalMiles: 0 };
    entry.totalCost += current.expenseAmount;
    entry.totalMiles += miles;
    map.set(key, entry);
  }
}

/** Build cost per distance chart data from consecutive fuel expense pairs. */
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
    .slice(-120); // Cap to last 120 entries
}

/** Assign maintenance timeline status based on days remaining. */
function assignTimelineStatus(daysRemaining: number): 'good' | 'warning' | 'overdue' {
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining < 30) return 'warning';
  return 'good';
}

/** Estimate the average interval in days between sorted service dates. */
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

/** Build a single maintenance timeline entry from a service group. */
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

/** Build maintenance timeline from maintenance expenses. */
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

/** Add efficiency data from consecutive fuel pairs to season data map. */
function addSeasonalEfficiencyData(
  fuelRows: FuelExpenseRow[],
  seasonData: Map<string, { effSum: number; effCount: number; fillupCount: number }>
): void {
  for (const vehicleRows of groupByVehicle(fuelRows).values()) {
    for (let i = 1; i < vehicleRows.length; i++) {
      const current = vehicleRows[i];
      const previous = vehicleRows[i - 1];
      if (!current || !previous) continue;
      const point = computeEfficiencyPoint(current, previous);
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

/** Build seasonal efficiency from fuel expense rows. */
export function buildSeasonalEfficiency(
  fuelRows: FuelExpenseRow[]
): Array<{ season: string; avgEfficiency: number; fillupCount: number }> {
  const seasonData = new Map<string, { effSum: number; effCount: number; fillupCount: number }>();

  for (const row of fuelRows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
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

/** Normalize a score to 0-100 range. */
function normalizeScore(value: number, min: number, max: number, invert: boolean): number {
  if (max === min) return 50;
  const ratio = (value - min) / (max - min);
  const score = invert ? 1 - ratio : ratio;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

/** Accumulate expense-based metrics per vehicle. */
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

/** Compute average fuel efficiency per vehicle from consecutive fuel pairs. */
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
      const point = computeEfficiencyPoint(rows[i] as FuelRow, rows[i - 1] as FuelRow);
      if (point) mpgValues.push(point.efficiency);
    }
    const m = metrics.get(vId);
    if (m && mpgValues.length > 0) {
      m.fuelEfficiency = mpgValues.reduce((a, b) => a + b, 0) / mpgValues.length;
    }
  }
}

/** Build vehicle radar scores from expense data. */
export function buildVehicleRadar(
  allExpenses: GeneralExpenseRow[],
  fuelRows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>
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
        Math.min(...fuelEffVals),
        Math.max(...fuelEffVals),
        false
      ),
      maintenanceCost: normalizeScore(
        m.maintenanceCost,
        Math.min(...maintCostVals),
        Math.max(...maintCostVals),
        true
      ),
      reliability: normalizeScore(
        m.maintenanceCount,
        Math.min(...reliabilityVals),
        Math.max(...reliabilityVals),
        true
      ),
      annualCost: normalizeScore(
        m.annualCost,
        Math.min(...annualCostVals),
        Math.max(...annualCostVals),
        true
      ),
      mileage: normalizeScore(
        m.totalMileage,
        Math.min(...mileageVals),
        Math.max(...mileageVals),
        false
      ),
    };
  });
}

/** Build day-of-week patterns from fuel expenses. */
export function buildDayOfWeekPatterns(
  fuelRows: FuelExpenseRow[]
): Array<{ day: string; fillupCount: number; avgCost: number; avgVolume: number }> {
  const dayData = new Map<string, { count: number; totalCost: number; totalGallons: number }>();

  for (const row of fuelRows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
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

/** Build monthly cost heatmap from all expenses. */
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
    .slice(-24) // Cap to last 24 months
    .map(([month, data]) => ({ month, ...data }));
}

/** Sort rows by date and accumulate day-gaps into buckets. */
function accumulateIntervalBuckets(
  vehicleRows: FuelExpenseRow[],
  buckets: Array<{ label: string; min: number; max: number; count: number }>
): void {
  const sorted = vehicleRows.sort((a, b) => {
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

/** Build fillup interval distribution from sorted fuel expenses. */
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

/** Compute maintenance regularity score from sorted maintenance expense dates. */
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

/** Compute mileage interval adherence score from maintenance expenses with mileage. */
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

/** Build TCO monthly trend grouped by category. */
export function buildTCOMonthlyTrend(
  rows: Array<{
    category: string;
    expenseAmount: number;
    date: Date | number | null;
    isFinancingPayment: boolean;
    insuranceTermId: string | null;
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
    if (row.category === 'financial' && row.isFinancingPayment) {
      entry.financing += row.expenseAmount;
    } else if (row.category === 'financial' && row.insuranceTermId) {
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

/** Build monthly maintenance costs for a vehicle. */
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

/** Accumulate fuel data for a single row into the month map. */
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

  if (
    prevRow &&
    row.mileage != null &&
    prevRow.mileage != null &&
    row.volume != null &&
    row.volume > 0
  ) {
    const miles = row.mileage - prevRow.mileage;
    if (miles > 0) {
      entry.totalMiles += miles;
      entry.totalGallons += row.volume;
    }
  }
  entry.count++;
  monthData.set(key, entry);
}

/** Build fuel efficiency and cost by month for a vehicle. */
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

/** Build expense breakdown by category for a vehicle. */
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

/** Build monthly expense trends from all expenses. */
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
    .slice(-24) // Cap to last 24 months
    .map(([month, amount]) => ({ month, amount }));
}

/** Build expense by category with percentages. */
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

/** Build fuel efficiency comparison across vehicles by month. */
export function buildFuelEfficiencyComparison(
  fuelRows: FuelExpenseRow[],
  vehicleNameMap: Map<string, string>
): Array<{
  month: string;
  vehicles: Array<{ vehicleId: string; vehicleName: string; efficiency: number }>;
}> {
  // Group fuel rows by vehicle
  const byVehicle = new Map<string, FuelExpenseRow[]>();
  for (const row of fuelRows) {
    const arr = byVehicle.get(row.vehicleId) ?? [];
    arr.push(row);
    byVehicle.set(row.vehicleId, arr);
  }

  // Compute monthly efficiency per vehicle
  const monthVehicleEff = new Map<string, Map<string, { sum: number; count: number }>>();
  for (const [vId, rows] of byVehicle) {
    for (let i = 1; i < rows.length; i++) {
      const point = computeEfficiencyPoint(rows[i] as FuelRow, rows[i - 1] as FuelRow);
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
    .slice(-24) // Cap to last 24 months
    .map(([month, vehicleMap]) => ({
      month,
      vehicles: Array.from(vehicleMap.entries()).map(([vId, data]) => ({
        vehicleId: vId,
        vehicleName: vehicleNameMap.get(vId) ?? 'Unknown',
        efficiency: data.count > 0 ? data.sum / data.count : 0,
      })),
    }));
}

/** Find the biggest expense from a list of general expense rows. */
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

/** Compute previous year comparison given current and previous totals. */
export function computePreviousYearComparison(
  currentTotal: number,
  previousTotal: number
): { totalSpent: number; percentageChange: number } | null {
  if (previousTotal <= 0) return null;
  const percentageChange = ((currentTotal - previousTotal) / previousTotal) * 100;
  return { totalSpent: previousTotal, percentageChange };
}
