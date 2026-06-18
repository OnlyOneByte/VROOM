/**
 * Characterization of fleet-wide fuel-stats distance pooling (#94, C301 deep-review → bug, ESCALATED).
 *
 * `GET /api/v1/analytics/fuel-stats` with NO vehicleId (the default analytics-summary path) aggregates
 * across ALL of a user's vehicles. `buildFuelStatsFromData` computes `distance.totalDistance` by summing
 * each vehicle's own (max − min) odometer span and `averageCost.best/worstCostPerDistance` as the min/max
 * of the per-pair cost/distance values — both across ALL vehicles, WITHOUT any unit conversion. Vehicles carry per-vehicle
 * `unitPreferences` (vehicles.unit_preferences), so a mi + km fleet pools miles and kilometres into one
 * number and averages $/mi with $/km — a NORTH_STAR #2 (correct-for-everyone) defect on the main analytics
 * view. The per-vehicle CHARTS (computeConvertedTotalDistance) already convert; only these summary SCALARS
 * don't. This is a semantics decision (convert-to-user-global / per-vehicle-only / require vehicleId),
 * ESCALATED to Angelo (#94) — NOT self-fixed. Distinct from #45 (period-scoping).
 *
 * This pins the CURRENT pooled-sum behavior so the fix has a red→green anchor and the bug can't silently
 * worsen. Both vehicles here share the default unit (the harness seeds no per-vehicle prefs), so the
 * numeric pooling is deterministic; the point of record is that totalDistance is the RAW SUM of the two
 * vehicles' spans (proving no per-vehicle normalization gate exists today). When the fix lands, update
 * this to assert the converted/segmented behavior.
 *
 * C328 (deep-review fan-out): #94 is NOT one scalar — it's a CLASS. The same no-conversion pooling spans
 * the whole fleet-summary + fuel-advanced path: distance (#94, pinned below), VOLUME (volume.currentYear +
 * fillupDetails, gal+L — pinned below as of C328), and the efficiency/volume pooling in
 * buildMonthlyConsumption / buildSeasonalEfficiency / buildVehicleRadar / buildDayOfWeekPatterns (mi/gal +
 * km/L). getCrossVehicle (repository.ts:1500/1531) is the correct contrast — it threads vehicleUnitsMap +
 * userUnits and converts per vehicle (convertDistance) BEFORE pooling. The summary builders receive no
 * units. ALL ESCALATED to Angelo as one #94 class — NOT self-fixed (product semantics: convert-to-global /
 * per-vehicle-only / require vehicleId).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnalyticsRepository } from '../repository';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
  type TestExpense,
} from './analytics-test-generators';

let testDb: TestDb;
let repo: AnalyticsRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AnalyticsRepository(testDb.drizzle);
});

afterEach(() => {
  testDb.sqlite.close();
});

const USER = { id: 'user-fleet', email: 'fleet@test.com', displayName: 'Fleet' };
const VEH_A = { id: 'veh-a', userId: 'user-fleet', make: 'Toyota', model: 'A', year: 2022 };
const VEH_B = { id: 'veh-b', userId: 'user-fleet', make: 'Honda', model: 'B', year: 2022 };

/** A fuel fillup with an explicit odometer reading, dated `daysAgo` before now (in-range). */
function fillup(
  id: string,
  vehicleId: string,
  mileage: number,
  amount: number,
  daysAgo: number,
  volume: number
): TestExpense {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return {
    id,
    vehicleId,
    category: 'fuel',
    expenseAmount: amount,
    date: d,
    mileage,
    volume,
    fuelType: 'Regular',
    missedFillup: false,
  };
}

function rangeAll() {
  return {
    start: Math.floor(new Date(2020, 0, 1).getTime() / 1000),
    end: Math.floor(Date.now() / 1000) + 86_400,
  };
}

describe('#94 — fleet-wide fuel-stats pools per-vehicle distance by raw summation', () => {
  test('totalDistance is the SUM of each vehicle (max − min) span, not pooled across the whole fleet', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    // Vehicle A spans 10_000 → 10_800 (driven 800); Vehicle B spans 50_000 → 50_200 (driven 200).
    // Correct PER-VEHICLE summation = 800 + 200 = 1_000. A naive fleet-wide max−min would give
    // 50_200 − 10_000 = 40_200 (the cross-vehicle pooling hazard this path already avoids). Spans stay
    // under MAX_REASONABLE_MILES_BETWEEN_FILLUPS (1000) + volumes give realistic MPG (A 800/20=40,
    // B 200/5=40) so computeEfficiencyPoint keeps both pairs. Both vehicles use the DEFAULT (miles) unit,
    // so the C58 #94 fix is a no-op here — the per-vehicle sum is still 1_000 (conversion only bites a
    // MIXED-unit fleet, the next test).
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    // Fleet-wide: no vehicleId.
    const stats = await repo.getFuelStats(USER.id, rangeAll());

    // Per-vehicle spans summed (800 + 200), NOT the cross-vehicle 40_200 pool. Same-unit → no conversion.
    expect(stats.distance.totalDistance).toBe(1_000);
  });

  // #94 FIXED (C58, Angelo-approved "convert-to-user-global BEFORE pooling, mirroring getCrossVehicle"):
  // a MIXED-unit fleet now converts each vehicle's distance span to the user's global unit before summing
  // totalDistance, so miles and kilometres are no longer added raw (NORTH_STAR #2). getFuelStats threads
  // the real userUnits + vehicleUnitsMap into computeConvertedTotalDistance (was fed no-op placeholders).
  test('a MIXED mi+km fleet converts each span to the user unit before summing (no raw mi+km pool)', async () => {
    seedUser(testDb.sqlite, USER); // user has no prefs → default MILES
    seedVehicle(testDb.sqlite, VEH_A); // miles (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports its odometer in KILOMETRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // A drives 800 mi; B drives 200 KM. Correct fleet total in the user's miles =
    // 800 + (200 km / 1.609344) ≈ 924.27 mi. The pre-fix raw pool would be 800 + 200 = 1_000.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    // Converted-then-summed, NOT the raw 1_000: 800 mi + 200 km→124.27 mi.
    expect(stats.distance.totalDistance).toBeCloseTo(800 + 200 / 1.609344, 2);
    expect(stats.distance.totalDistance).not.toBe(1_000);
  });

  test('volume.currentYear + fillupDetails pool gal/L by RAW summation across the fleet (#94 sibling, C328)', async () => {
    // The SAME defect mechanism as distance/cost above, on a DIFFERENT scalar: buildFuelStatsFromData
    // sums every fuel row's `volume` (sumGallons, repository.ts:1357) and derives fillupDetails
    // (avg/min/max volume) across ALL vehicles with NO per-vehicle unit conversion. Volume is stored in
    // each vehicle's own volumeUnit (gal OR L), so a mixed-unit fleet pools gallons with litres into one
    // headline number — the volume limb of the #94 class the C328 deep-review surfaced (alongside
    // buildMonthlyConsumption / buildSeasonalEfficiency / buildVehicleRadar / buildDayOfWeekPatterns,
    // all on the fleet-summary + fuel-advanced paths; all ESCALATED to Angelo, NOT self-fixed — same
    // semantics call as #94). Both vehicles share the default unit here so the pool is deterministic;
    // the point of record is that volume is the RAW SUM (proving no per-vehicle normalization gate
    // exists today), the same proof shape the distance pin above uses. Update when the fix lands.
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    // A: two 20-volume fillups (40 total); B: two 5-volume fillups (10 total). Raw fleet pool = 50.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    // CURRENT behavior: volume summed across the whole fleet, no per-vehicle gal↔L normalization.
    expect(stats.volume.currentYear).toBe(50);
    // fillupDetails are the raw cross-vehicle avg/min/max of the four volumes [20,20,5,5].
    expect(stats.fillupDetails.avgVolume).toBeCloseTo(12.5, 5);
    expect(stats.fillupDetails.minVolume).toBe(5);
    expect(stats.fillupDetails.maxVolume).toBe(20);
  });

  test('best/worst cost-per-distance span the per-pair values across the WHOLE fleet (un-normalized scalars)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    // A: 800 driven for $40 on the 2nd fillup → $0.05/dist. B: 200 driven for $40 → $0.20/dist.
    // averageCost reports best = min across ALL vehicles' per-pair values ($0.05), worst = max ($0.20).
    // For a mixed-unit fleet these min/max would silently compare $/mi against $/km (#94) — the values
    // aren't normalized to a common unit before the cross-vehicle min/max. Spans < 1000 + volumes →
    // realistic MPG so both pairs survive computeEfficiencyPoint.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    // Cross-vehicle min/max of the raw per-pair cost/distance, no per-vehicle unit normalization.
    expect(stats.averageCost.bestCostPerDistance).toBeCloseTo(0.05, 5);
    expect(stats.averageCost.worstCostPerDistance).toBeCloseTo(0.2, 5);
  });
});
