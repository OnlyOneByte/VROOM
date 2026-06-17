import { isElectricFuelType } from '../db/types';
import { maxOf, minOf } from './calculations';

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

/**
 * A row counts as a real FILLUP only if it carries a positive volume. queryFuelExpenses returns ALL
 * category='fuel' rows with no volume filter, and a SPLIT fuel expense creates one sibling PER VEHICLE
 * with volume=null (createSiblings never sets it) — so any fillup-COUNT or per-fillup-average that
 * counts raw rows overcounts a single split fillup as N (the #56/#18/#108/#113 split-sibling overcount
 * class). This is the ONE source of truth for that predicate (was hand-inlined at computeAverageCosts,
 * buildSeasonalEfficiency, buildDayOfWeekPatterns, buildFillupCostByVehicle [#146] + re-defined locally
 * in analytics/repository's buildFuelStatsFromData); a divergent copy silently reintroduces the
 * overcount on one surface.
 */
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
  // Needed so the monthly MPG accumulator can skip multi-tank windows (matches FuelRow).
  missedFillup: boolean;
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

/**
 * A GAS-MPG efficiency point: like computeEfficiencyPoint but null for an electric `current` row. ONE
 * source of truth (C413, #122) for the gas/charge partition every MPG-aggregating builder needs — a
 * charge session stores kWh in `volume`, so computeEfficiencyPoint emits a ~mi/kWh value that, summed
 * into a gas-MPG average labeled mi/gal (getFuelEfficiencyLabel is always distance/volume), drags the
 * average down + mislabels a charge's mi/kWh (#119 fixed the headline FuelStats card C411; this sweeps
 * the sibling builders — buildMonthlyConsumption, addSeasonalEfficiencyData, computePerVehicleFuelEfficiency,
 * the per-vehicle monthly comparison). The C353 gas/charge isolation vehicle-stats.ts does, here for the
 * analytics pairing builders. EV-only efficiency belongs on the mi/kWh surface, not a mi/gal chart, so a
 * gas-less car correctly contributes no point here. (cost-per-mile is NOT gated — it spans all energy,
 * the C378 invariant — so computeMpgAndCostPerMile still calls computeEfficiencyPoint directly for cost.)
 */
export function gasEfficiencyPoint(
  current: FuelRow,
  previous: FuelRow
): FuelEfficiencyPoint | null {
  if (isElectricFuelType(current.fuelType)) return null;
  return computeEfficiencyPoint(current, previous);
}

/** Convert a date to a YYYY-MM month key. */
export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Every YYYY-MM month key from `start`'s month through `end`'s month, inclusive.
 *
 * The cursor is anchored to day-1 of each month: stepping a raw day-29..31 date with
 * setMonth overshoots short months (Jan 31 -> "Feb 31" rolls to Mar 2/3), silently SKIPPING
 * February. Anchoring to day-1 is rollover-safe and matches what toMonthKey reads (year+month
 * only). Returns [] if either bound is null or start is after end.
 */
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

/**
 * Effective monthly premium for an insurance term.
 *
 * A term may record its cost either as a recurring `monthlyCost` OR as a lump-sum `totalCost`
 * (e.g. a "6-month policy = $1,200" entered as totalCost=1200, monthlyCost=null). The premium
 * math must honour both: using `monthlyCost ?? 0` silently contributes $0 for every totalCost-only
 * term, zeroing its premium total and trend (bug #8).
 *
 * Precedence: an explicit `monthlyCost` wins. Otherwise amortize `totalCost` across the term's
 * span — `monthsInTerm = monthKeysInRange(start, end).length` (day-1 anchored, inclusive of both
 * endpoint months, matching how the premium trend buckets). Returns 0 when neither cost is set or
 * the term has no resolvable span to amortize across.
 */
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

/** One loan's amortization inputs: current balance, annual rate %, fixed monthly payment. */
export interface AmortizationLoan {
  balance: number;
  apr: number;
  paymentAmount: number;
}

/**
 * Amortization schedule: per-month total interest + principal across a set of loans (bug #10).
 *
 * Each month, a loan's interest = balance * (apr/100/12) and its principal = payment − interest;
 * the balance is then REDUCED by that principal for the next month. The old buildLoanBreakdown
 * computed interest off a balance it never decremented, so every one of the 12 months reported the
 * SAME interest/principal (interest never declined, principal never rose, and a loan that pays off
 * mid-window was over-projected). This walks the balance down month over month, clamping at 0 so a
 * paid-off loan contributes nothing further (no negative interest, no phantom principal).
 *
 * Pure + caller-resolved (no DB): the caller supplies current balances and the month-key labels, so
 * this is unit-testable. `monthKeys.length` months are emitted in order.
 */
export function buildAmortizationSchedule(
  loans: AmortizationLoan[],
  monthKeys: string[]
): Array<{ month: string; interest: number; principal: number }> {
  // Local running balances so we don't mutate the caller's inputs.
  const balances = loans.map((l) => l.balance);

  return monthKeys.map((month) => {
    let totalInterest = 0;
    let totalPrincipal = 0;
    for (let i = 0; i < loans.length; i++) {
      const balance = balances[i];
      if (balance <= 0) continue; // paid off — contributes nothing
      const interest = balance * (loans[i].apr / 100 / 12);
      // Principal can't exceed the remaining balance (the final payment is smaller).
      const principal = Math.min(Math.max(0, loans[i].paymentAmount - interest), balance);
      totalInterest += Math.max(0, interest);
      totalPrincipal += principal;
      balances[i] = balance - principal;
    }
    return { month, interest: totalInterest, principal: totalPrincipal };
  });
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
export function groupByVehicle<T extends { vehicleId: string }>(rows: T[]): Map<string, T[]> {
  const byVehicle = new Map<string, T[]>();
  for (const row of rows) {
    const arr = byVehicle.get(row.vehicleId) ?? [];
    arr.push(row);
    byVehicle.set(row.vehicleId, arr);
  }
  return byVehicle;
}

/**
 * Iterate consecutive fuel pairs WITHIN each vehicle group. Generic over any row carrying `vehicleId`
 * (it only reads that for grouping; the pairing is type-agnostic). Grouping by vehicle first is what
 * stops a date-ordered multi-vehicle list from pairing two DIFFERENT cars' consecutive rows — the
 * cross-vehicle pooling hazard (#54): `current.mileage − previous.mileage` across cars is meaningless.
 * Exported so getFuelEfficiencyTrend can reuse the exact same per-vehicle pairing as the MPG/cost charts.
 */
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

/**
 * Return a COPY of `rows` sorted by (vehicleId, then date ascending) — the canonical pre-sort the
 * per-vehicle MPG / cost-per-distance / odometer-progression builders need before pairing consecutive
 * rows (so forEachVehiclePair never straddles two cars or goes out of date order). The whole comparator
 * was hand-duplicated byte-for-byte at 3 sites in analytics/repository.ts (C200 dedup). The date-key
 * preserves the original `instanceof Date ? getTime() : Number(date)` exactly: `date` is `Date | number
 * | null` (never a string), so a number is already epoch-ms and `Number(null)` → 0, both unchanged.
 */
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

    // mpgValues feeds the FuelStats "Fuel Consumption" card, labeled mi/gal — so a charge session's
    // ~mi/kWh must NOT count toward it (#119/C411). gasEfficiencyPoint is the ONE source of truth for
    // that gas/charge partition (C413). costPerMileValues is INTENTIONALLY unfiltered: cost per mile is
    // total energy spend over total miles (fuel + charge), a consistent $/mi (C378) — so the cost block
    // below uses `point` (any fuel type), while only a gas point counts toward mpg.
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

  // Add efficiency data from consecutive pairs within each vehicle group. gasEfficiencyPoint (not
  // computeEfficiencyPoint) so a PHEV's charge mi/kWh doesn't pollute this gas-MPG average (#122/C413).
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

  return (
    Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      // Keep the most RECENT 12 months (slice from the end of the ascending sort). slice(0, 12)
      // would keep the OLDEST 12 and hide the current period once a user has >12 months of data.
      .slice(-12)
      .map(([month, data]) => ({
        month,
        efficiency: data.effCount > 0 ? data.effSum / data.effCount : 0,
        volume: data.volume,
      }))
  );
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
    // Count only volume-bearing rows: a SPLIT fuel expense creates one sibling per vehicle with
    // volume=null, so an unguarded count/sum treats each partial-cost allocation as a standalone
    // fillup and dilutes the per-vehicle average fillup cost (#146, the #56/#108/#113 split-sibling
    // overcount class — the member the C391 sweep + the isFillup docstring's swept-site list missed).
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
    bestEfficiency: maxOf(efficiencyValues),
    worstEfficiency: minOf(efficiencyValues),
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
  // avg cost/fillup must be cost-of-fillups ÷ fillup-count, both over the SAME basis. A split fuel
  // expense creates one sibling PER VEHICLE — each carrying its cost share but volume=null
  // (createSiblings never sets volume) — so a row-based count overcounts a split fillup as N,
  // understating avg cost/fillup ~Nx (#56, the #18 class for this field). Restrict BOTH the numerator
  // and denominator to volume-bearing rows (a real fillup has a volume), matching the isFillup predicate
  // the fuel-stats COUNT already uses (C97): a null-volume split sibling counts as 0 fillups there, so
  // its share must drop out of perFillup too (else cost-in-numerator / count-not-in-denominator inflates
  // it). For an unsplit fillup volume>0 && cost>0 both hold, so this equals the old value on the common path.
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

/**
 * Miles driven between a consecutive fill-up pair, or null if the window isn't a valid
 * distance measurement — mirroring computeEfficiencyPoint: a missed/partial fill-up (either
 * row) spans multiple tanks, a non-positive delta is out-of-order/duplicate data, and an
 * implausibly large gap (> cap) is bad data. Used so month aggregators can't fold a bogus
 * window into MPG / cost-per-distance.
 */
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

/** Accumulate cost-per-mile data from consecutive fuel expense pairs for a single vehicle. */
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
      // gasEfficiencyPoint: gas-MPG only, no PHEV charge mi/kWh in this seasonal average (#122/C413).
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

/** Build seasonal efficiency from fuel expense rows. */
export function buildSeasonalEfficiency(
  fuelRows: FuelExpenseRow[]
): Array<{ season: string; avgEfficiency: number; fillupCount: number }> {
  const seasonData = new Map<string, { effSum: number; effCount: number; fillupCount: number }>();

  for (const row of fuelRows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    // Count only volume-bearing rows as fillups (#108, the #56/#18/C97 class). A split fuel
    // expense creates one sibling PER VEHICLE, each carrying its cost share but volume=null
    // (createSiblings never sets volume), so an unconditional row count would overcount a single
    // split fillup as N in the season's fillupCount. A real fillup has a volume — mirror the
    // isFillup predicate computeAverageCosts and the fuel-stats COUNT (C97) already use.
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
      // gasEfficiencyPoint: this feeds the radar's fuelEfficiency (gas MPG), no charge mi/kWh (#122/C413).
      const point = gasEfficiencyPoint(rows[i] as FuelRow, rows[i - 1] as FuelRow);
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

/** Build day-of-week patterns from fuel expenses. */
export function buildDayOfWeekPatterns(
  fuelRows: FuelExpenseRow[]
): Array<{ day: string; fillupCount: number; avgCost: number; avgVolume: number }> {
  const dayData = new Map<string, { count: number; totalCost: number; totalGallons: number }>();

  for (const row of fuelRows) {
    const d = normalizeDate(row.date);
    if (!d) continue;
    // Count only volume-bearing rows as fillups (#113, the #56/#18/C97/#108 split-sibling class — the
    // sibling buildSeasonalEfficiency already guards this at :644). A split fuel expense creates one
    // sibling PER VEHICLE, each with its cost share but volume=null (createSiblings never sets volume),
    // and queryFuelExpenses has no volume filter — so an unconditional count would overcount one split
    // fillup as N AND skew avgVolume (totalGallons/N) + avgCost (per-row not per-fillup). A real fillup
    // has a volume; mirror computeAverageCosts.
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
  // Copy before sorting: today the caller passes a freshly-grouped local array so an
  // in-place sort is harmless, but a defensive copy keeps this helper pure (no input
  // mutation) so a future caller that passes a shared/order-significant array can't be
  // bitten by a hidden reorder. Behavior-identical for the current call site.
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

  // Only fold a pair into the month's MPG when it's a valid distance window (skips missed
  // fill-ups + over-cap gaps, mirroring computeEfficiencyPoint) AND this row has volume —
  // else one tank's volume gets counted against two tanks' miles, inflating MPG.
  const miles = prevRow ? validMilesBetween(row, prevRow) : null;
  if (miles !== null && row.volume != null && row.volume > 0) {
    entry.totalMiles += miles;
    entry.totalGallons += row.volume;
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
      // gasEfficiencyPoint: per-vehicle gas-MPG comparison, no PHEV charge mi/kWh (#122/C413).
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
