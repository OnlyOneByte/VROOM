import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { AppDatabase } from '../../db/connection';
import { expenses, odometerEntries, trips } from '../../db/schema';
import { isElectricFuelType } from '../../db/types';
import { attributeDistance, type Period } from './distance';
import { listDrivers } from './repository';

const RUNNING_CATEGORIES = new Set(['fuel', 'maintenance', 'misc']);

export interface StatsOptions {
  period: Period;
  withEstimates: boolean;
  viewerUserId: string;
  everyone: boolean;
  includeCarCosts: boolean;
  scale: number;
}

export interface DriverFigures {
  driverId: string;
  name: string;
  color: string | null;
  archived: boolean;
  you: boolean;
  distance: { trips: number; estimated: number; total: number };
  share: number | null;
  fuelBought: number;
  fuelUsed: number | null;
  chargeBought: number;
  chargeUsed: number | null;
  runningCostsPaid: number;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

function loadEntries(db: AppDatabase, vehicleId: string, period: Period) {
  const to = new Date(period.to);
  const readings = db
    .select({
      odometer: odometerEntries.odometer,
      at: odometerEntries.recordedAt,
      driverId: odometerEntries.driverId,
    })
    .from(odometerEntries)
    .where(and(eq(odometerEntries.vehicleId, vehicleId), lte(odometerEntries.recordedAt, to)))
    .all();
  const fillUps = db
    .select({ odometer: expenses.mileage, at: expenses.date, driverId: expenses.paidByDriverId })
    .from(expenses)
    .where(
      and(eq(expenses.vehicleId, vehicleId), isNotNull(expenses.mileage), lte(expenses.date, to))
    )
    .all();
  const points = [...readings, ...fillUps].map((p) => ({
    odometer: p.odometer ?? 0,
    at: p.at.getTime(),
    driverId: p.driverId,
  }));

  const spans = db
    .select({
      start: trips.startOdometer,
      end: trips.endOdometer,
      at: trips.tripDate,
      driverId: trips.driverId,
    })
    .from(trips)
    .where(eq(trips.vehicleId, vehicleId))
    .all()
    .map((t) => ({ ...t, at: t.at.getTime() }));

  const spending = db
    .select({
      category: expenses.category,
      cents: expenses.expenseAmount,
      volume: expenses.volume,
      fuelType: expenses.fuelType,
      payer: expenses.paidByDriverId,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.vehicleId, vehicleId),
        gte(expenses.date, new Date(period.from)),
        lte(expenses.date, to)
      )
    )
    .all()
    .filter((e) => RUNNING_CATEGORIES.has(e.category));

  return { points, spans, spending };
}

export function driverStats(db: AppDatabase, vehicleId: string, options: StatsOptions) {
  const { points, spans, spending } = loadEntries(db, vehicleId, options.period);
  const distances = attributeDistance(points, spans, options.period, options.withEstimates);
  const totalOf = (key: string | null) => {
    const row = distances.get(key);
    return row ? row.trips + row.estimated : 0;
  };

  const drivers = listDrivers(db, vehicleId);
  const attributed = drivers.reduce((sum, d) => sum + totalOf(d.id), 0);
  const unattributed = [...distances.keys()]
    .filter((key) => !drivers.some((d) => d.id === key))
    .reduce((sum, key) => sum + totalOf(key), 0);
  const totalDistance = attributed + unattributed;
  const boughtOf = (electric: boolean, payer?: string) =>
    spending.reduce((sum, e) => {
      const counts =
        e.category === 'fuel' &&
        isElectricFuelType(e.fuelType) === electric &&
        (!payer || e.payer === payer);
      return sum + (counts ? (e.volume ?? 0) : 0);
    }, 0);
  const centsPaidBy = (payer: string) =>
    spending.reduce((sum, e) => sum + (e.payer === payer ? e.cents : 0), 0);
  const runningCents = spending.reduce((sum, e) => sum + e.cents, 0);
  const perDistance = (amount: number) => (totalDistance > 0 ? amount / totalDistance : null);
  const fuelRate = perDistance(boughtOf(false));
  const chargeRate = perDistance(boughtOf(true));
  const used = (rate: number | null, distance: number) =>
    rate === null ? null : round(rate * distance);

  const figures: DriverFigures[] = drivers
    .filter((d) => options.everyone || d.userId === options.viewerUserId)
    .filter((d) => !d.archived || totalOf(d.id) > 0 || centsPaidBy(d.id) > 0)
    .map((d) => {
      const row = distances.get(d.id) ?? { trips: 0, estimated: 0 };
      const total = row.trips + row.estimated;
      return {
        driverId: d.id,
        name: d.name,
        color: d.color,
        archived: d.archived,
        you: d.userId === options.viewerUserId,
        distance: { trips: row.trips, estimated: row.estimated, total },
        share: options.everyone && attributed > 0 ? round(total / attributed, 4) : null,
        fuelBought: round(boughtOf(false, d.id)),
        fuelUsed: options.includeCarCosts ? used(fuelRate, total) : null,
        chargeBought: round(boughtOf(true, d.id)),
        chargeUsed: options.includeCarCosts ? used(chargeRate, total) : null,
        runningCostsPaid: centsPaidBy(d.id) / options.scale,
      };
    });

  const costRate = perDistance(runningCents);
  return {
    period: {
      from: new Date(options.period.from).toISOString(),
      to: new Date(options.period.to).toISOString(),
    },
    estimates: options.withEstimates,
    scope: options.everyone ? ('everyone' as const) : ('own' as const),
    distance: options.everyone ? { total: totalDistance, attributed, unattributed } : null,
    runningCosts: options.includeCarCosts ? runningCents / options.scale : null,
    costPerDistance:
      options.includeCarCosts && costRate !== null ? round(costRate / options.scale, 4) : null,
    drivers: figures,
  };
}
