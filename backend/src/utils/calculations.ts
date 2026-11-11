interface EfficiencyExpense {
  mileage: number | null;
  volume: number | null;
  missedFillup: boolean;
  date: Date | string;
}

// Pairwise efficiency math needs ascending date order; this sorts a copy so the input is not
// mutated.
export function sortExpensesByDate<T extends { date: Date | string }>(expenses: T[]): T[] {
  return [...expenses].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// Shared with analytics-charts so the per-vehicle stats and the analytics charts agree on outliers.
export const MIN_VALID_MPG = 5;
export const MAX_VALID_MPG = 100;
export const MIN_VALID_MI_KWH = 1;
export const MAX_VALID_MI_KWH = 10;

function calculateMPG(miles: number, fuel: number): number {
  return fuel > 0 ? miles / fuel : 0;
}

interface MpgPairRow {
  mileage?: number | null;
  volume?: number | null;
  missedFillup?: boolean;
}

// Expects rows already sorted ascending by date. Callers own their sort.
export function averageConsecutiveMpg(sortedExpenses: MpgPairRow[]): number | null {
  const mpgValues: number[] = [];

  for (let i = 1; i < sortedExpenses.length; i++) {
    const current = sortedExpenses[i];
    const previous = sortedExpenses[i - 1];

    // A pair touching a missed fill-up spans an unlogged gap.
    if (current.missedFillup || previous.missedFillup) {
      continue;
    }

    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const mpg = calculateMPG(miles, current.volume);

      if (mpg >= MIN_VALID_MPG && mpg <= MAX_VALID_MPG) {
        mpgValues.push(mpg);
      }
    }
  }

  if (mpgValues.length === 0) {
    return null;
  }

  const sum = mpgValues.reduce((acc, mpg) => acc + mpg, 0);
  return sum / mpgValues.length;
}

function calculateMilesPerKwh(miles: number, kwh: number): number {
  return kwh > 0 ? miles / kwh : 0;
}

export function calculateAverageMilesPerKwh(chargeExpenses: EfficiencyExpense[]): number | null {
  if (chargeExpenses.length < 2) {
    return null;
  }

  const sortedExpenses = sortExpensesByDate(chargeExpenses);

  const withMileage = sortedExpenses.filter((e) => e.mileage != null);
  if (withMileage.length < 2) {
    return null;
  }

  const milesPerKwhValues: number[] = [];

  for (let i = 1; i < sortedExpenses.length; i++) {
    const current = sortedExpenses[i];
    const previous = sortedExpenses[i - 1];

    if (current.missedFillup || previous.missedFillup) {
      continue;
    }

    if (current.mileage && previous.mileage && current.volume) {
      const miles = current.mileage - previous.mileage;
      const milesPerKwh = calculateMilesPerKwh(miles, current.volume);

      if (milesPerKwh >= MIN_VALID_MI_KWH && milesPerKwh <= MAX_VALID_MI_KWH) {
        milesPerKwhValues.push(milesPerKwh);
      }
    }
  }

  if (milesPerKwhValues.length === 0) {
    return null;
  }

  const sum = milesPerKwhValues.reduce((acc, val) => acc + val, 0);
  return sum / milesPerKwhValues.length;
}

export type StatsPeriod = '7d' | '30d' | '90d' | '1y' | 'all';

const PERIOD_DAYS: Record<Exclude<StatsPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

// 'all' returns null, meaning no lower date bound.
export function getPeriodStartDate(period: StatsPeriod, now: Date = new Date()): Date | null {
  if (period === 'all') return null;
  return new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
}

// Non-numeric or missing input falls back; otherwise the value is clamped to [min, max].
export function parseClampedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

// Math.max(...arr) overflows the call stack on large arrays, so these use a loop. Like
// Math.max/min, they return -Infinity/+Infinity for an empty array; callers must guard emptiness.
export function maxOf(values: number[]): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v > max) max = v;
  }
  return max;
}

export function minOf(values: number[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
  }
  return min;
}
