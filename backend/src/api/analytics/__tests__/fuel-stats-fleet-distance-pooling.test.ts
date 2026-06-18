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
    // all on the fleet-summary + fuel-advanced paths. The VOLUME member is now FIXED (C62, Angelo-approved
    // convert-before-pool); both vehicles share the default unit HERE, so the fix is a no-op and these
    // same-unit numbers are unchanged (the mixed-unit conversion is pinned by the next test).
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    // A: two 20-volume fillups (40 total); B: two 5-volume fillups (10 total). Same-unit fleet pool = 50.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    // Same-unit fleet → conversion is a no-op → the volume sum + fillupDetails are the plain values.
    expect(stats.volume.currentYear).toBe(50);
    expect(stats.fillupDetails.avgVolume).toBeCloseTo(12.5, 5);
    expect(stats.fillupDetails.minVolume).toBe(5);
    expect(stats.fillupDetails.maxVolume).toBe(20);
  });

  // #94 VOLUME member FIXED (C62, Angelo-approved "convert-to-user-global BEFORE pooling"): a MIXED gal+L
  // fleet now converts each row's volume to the user's global volume unit before summing the headline
  // volume + deriving fillupDetails, so gallons and litres are no longer added raw (NORTH_STAR #2).
  test('a MIXED gal+L fleet converts each volume to the user unit before pooling (no raw gal+L sum)', async () => {
    seedUser(testDb.sqlite, USER); // user has no prefs → default GALLONS_US
    seedVehicle(testDb.sqlite, VEH_A); // gallons (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports its volume in LITRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // A: two 20-GALLON fillups (40 gal). B: two 5-LITRE fillups (10 L). Correct user-unit (gal) total =
    // 40 + (10 L / 3.785411784) ≈ 42.642 gal. The pre-fix raw pool would be 40 + 10 = 50.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());

    // Converted-then-summed, NOT the raw 50: 40 gal + 10 L→2.642 gal.
    const litreToGal = 10 / 3.785411784;
    expect(stats.volume.currentYear).toBeCloseTo(40 + litreToGal, 2);
    expect(stats.volume.currentYear).not.toBe(50);
    // fillupDetails: the four volumes converted to gal are [20, 20, 5L→1.321, 5L→1.321] → max 20, min ~1.32.
    expect(stats.fillupDetails.maxVolume).toBeCloseTo(20, 5);
    expect(stats.fillupDetails.minVolume).toBeCloseTo(5 / 3.785411784, 2);
  });

  // #94 PREV-YEAR sub-member FIXED (C79, the LAST #94 member): volume.previousYear came from a raw SQL
  // SUM(volume) in queryFuelAggregates over the prior equal-length window — cross-vehicle, UN-converted —
  // so a mixed gal+L fleet pooled litres with gallons into the "Last Period" comparison (the prev-year twin
  // of the C62 current-period fix). queryFuelAggregates now GROUPs the volume SUM BY vehicle, and
  // buildFuelStatsFromData converts each vehicle's prev-window sum to the user's global unit before pooling.
  test('volume.previousYear converts each vehicle prev-window sum to the user unit before pooling (mixed gal+L)', async () => {
    seedUser(testDb.sqlite, USER); // default GALLONS_US
    seedVehicle(testDb.sqlite, VEH_A); // gallons (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports its volume in LITRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // Range = calendar 2024 → the prior equal-length window is calendar 2023. Seed PREV-WINDOW (2023) fuel:
    // A two 20-GALLON fillups (40 gal); B two 5-LITRE fillups (10 L → 10/3.785411784 ≈ 2.642 gal). Converted
    // prev-year total = 40 + 2.642 ≈ 42.64 gal; the pre-fix raw SQL pool would be 40 + 10 = 50.
    const d2023 = (mo: number, day: number): TestExpense => ({
      id: `p-${mo}-${day}`,
      vehicleId: VEH_A.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, mo, day),
      mileage: 10_000 + mo * 100,
      volume: 20,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, d2023(2, 1));
    seedExpense(testDb.sqlite, d2023(5, 1));
    seedExpense(testDb.sqlite, {
      id: 'p-b1',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, 2, 2),
      mileage: 50_000,
      volume: 5,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'p-b2',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, 5, 2),
      mileage: 50_200,
      volume: 5,
      fuelType: 'Regular',
      missedFillup: false,
    });

    // Range = calendar 2024 (its prior equal-length window is calendar 2023, where the rows above live).
    const range = {
      start: Math.floor(new Date(2024, 0, 1).getTime() / 1000),
      end: Math.floor(new Date(2025, 0, 1).getTime() / 1000),
    };
    const stats = await repo.getFuelStats(USER.id, range);

    expect(stats.volume.previousYear).toBeCloseTo(40 + 10 / 3.785411784, 2);
    expect(stats.volume.previousYear).not.toBeCloseTo(50, 1); // NOT the raw gal+L SQL pool
  });

  // bug #18 PREV-PERIOD axis (the C97 currentYear guard's missing twin): the "This Period vs Last Period"
  // fillup comparison computes its two halves through DIFFERENT predicate implementations across two layers —
  // fillups.currentYear is in-memory `fuelRows.filter(isFillup)` (volume != null && volume > 0), while
  // fillups.previousYear is the SQL `COUNT(CASE WHEN volume > 0 THEN 1 END)` in queryFuelAggregates (coupled
  // only by the "matches the isFillup predicate" comment). A split fuel expense creates volume-null siblings
  // (ExpenseSplitService.createSiblings) that must NOT inflate either count (bug #18). C97's guard pins ONLY
  // the currentYear/in-memory half; nothing exercises the prev-period SQL count's null-exclusion — drop the
  // `CASE WHEN volume > 0` (e.g. plain COUNT(*)) and the prev-period count silently inflates by the split
  // legs while every test stays green, so "Last Period" over-reports fillups (NORTH_STAR #2). This pins the
  // SQL half against the same bug on the prev-window.
  test('fillups.previousYear excludes volume-null split siblings (bug #18 on the prev-period SQL count)', async () => {
    seedUser(testDb.sqlite, USER);
    seedVehicle(testDb.sqlite, VEH_A);
    seedVehicle(testDb.sqlite, VEH_B);

    // Range = calendar 2024 → the prior equal-length window is calendar 2023. Seed PREV-WINDOW (2023):
    // two genuine fillups (volume-bearing) + one fuel expense split across both cars (two volume-null
    // siblings). The prev-period fillup count must be 2 (real fillups only), NOT 4 (raw row count).
    seedExpense(testDb.sqlite, {
      id: 'py-real-a',
      vehicleId: VEH_A.id,
      category: 'fuel',
      expenseAmount: 40,
      date: new Date(2023, 2, 10),
      mileage: 10_000,
      volume: 10,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'py-real-b',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 38,
      date: new Date(2023, 2, 12),
      mileage: 50_000,
      volume: 9,
      fuelType: 'Regular',
      missedFillup: false,
    });
    // The split fuel expense: AMOUNT split across both cars, volume=null on each sibling.
    seedExpense(testDb.sqlite, {
      id: 'py-split-a',
      vehicleId: VEH_A.id,
      category: 'fuel',
      expenseAmount: 12.5,
      date: new Date(2023, 4, 1),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, {
      id: 'py-split-b',
      vehicleId: VEH_B.id,
      category: 'fuel',
      expenseAmount: 12.5,
      date: new Date(2023, 4, 1),
      mileage: null,
      volume: null,
      fuelType: null,
      missedFillup: false,
    });

    const range = {
      start: Math.floor(new Date(2024, 0, 1).getTime() / 1000),
      end: Math.floor(new Date(2025, 0, 1).getTime() / 1000),
    };
    const stats = await repo.getFuelStats(USER.id, range);

    // Two real fillups; the two volume-null split siblings are NOT fillups. A plain COUNT(*) would give 4.
    expect(stats.fillups.previousYear).toBe(2);
    // The prev-period volume SUM was always correct (null volume contributes 0) — sanity-pin it stays 19.
    expect(stats.volume.previousYear).toBe(19);
  });

  // #94 MONTHLY-CONSUMPTION member FIXED (C65, same Angelo-approved convert-before-pool direction): the
  // monthlyConsumption chart series (volume + gas-MPG per month) is the 4th #94 limb — buildMonthlyConsumption
  // pools each row's raw volume into a month AND averages each gas pair's raw efficiency, both across all
  // vehicles with no per-vehicle conversion. getFuelStats now routes a MIXED-unit fleet through
  // buildConvertedMonthlyConsumption (convertVolume per row + the C64 convertedGasEfficiencyPoints generator),
  // so a gal+L fleet no longer sums litres into the gallons volume series (NORTH_STAR #2). A same-unit fleet
  // still takes the pure builder (skipConversion), so its numbers are unchanged.
  test('monthlyConsumption volume is converted to the user unit before pooling on a MIXED gal+L fleet (no raw gal+L sum)', async () => {
    seedUser(testDb.sqlite, USER); // default GALLONS_US
    seedVehicle(testDb.sqlite, VEH_A); // gallons (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports its volume in LITRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // A: two 20-GALLON fillups (40 gal). B: two 5-LITRE fillups (10 L → 2.642 gal). Converted total
    // volume across the series = 40 + 10/3.785411784 ≈ 42.642 gal; the pre-fix raw pool would be 50.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_800, 40, 30, 20));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 5));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_200, 40, 30, 5));

    const stats = await repo.getFuelStats(USER.id, rangeAll());
    const totalVolume = stats.monthlyConsumption.reduce((s, m) => s + m.volume, 0);

    expect(totalVolume).toBeCloseTo(40 + 10 / 3.785411784, 2);
    expect(totalVolume).not.toBeCloseTo(50, 1);
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

  // #94 SEASONAL-EFFICIENCY member FIXED (C69, same Angelo-approved convert-before-pool direction): the
  // getFuelAdvanced seasonalEfficiency series (avg gas-MPG per season) is the 4th unit-bearing #94 limb —
  // buildSeasonalEfficiency averages each gas pair's RAW efficiency across all vehicles with no per-vehicle
  // conversion. getFuelAdvanced now threads units + routes a MIXED-unit fleet through
  // buildConvertedSeasonalEfficiency (the C64 convertedGasEfficiencyPoints generator), so a mi/gal + km/L
  // fleet no longer averages mi/gal with km/L (NORTH_STAR #2). A same-unit fleet still takes the pure builder.
  test('seasonal avgEfficiency converts each gas pair to the user unit before pooling on a MIXED mi/gal+km/L fleet', async () => {
    seedUser(testDb.sqlite, USER); // default MILES / GALLONS_US
    seedVehicle(testDb.sqlite, VEH_A); // miles/gallons (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports distance in KILOMETRES and volume in LITRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // Both vehicles' fillups land in JANUARY (Winter) so they pool into one season bucket. Adjacent pairs
    // per vehicle. A: 10000→10300 mi on 10 gal = 30 mi/gal. B: 50000→50320 km on 8 L = 40 km/L (in the
    // [5,100] band so the gas point survives), which converts to 40/1.609344×3.785411784 ≈ 94.07 mi/gal.
    // Converted seasonal avg = (30 + 94.07)/2 ≈ 62.04; the pre-fix RAW pool would be (30 + 40)/2 = 35.
    const jan = (day: number) => new Date(2024, 0, day);
    const fuelOn = (
      id: string,
      vid: string,
      mileage: number,
      vol: number,
      day: number
    ): TestExpense => ({
      id,
      vehicleId: vid,
      category: 'fuel',
      expenseAmount: 50,
      date: jan(day),
      mileage,
      volume: vol,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, fuelOn('a1', VEH_A.id, 10_000, 10, 5));
    seedExpense(testDb.sqlite, fuelOn('a2', VEH_A.id, 10_300, 10, 10));
    seedExpense(testDb.sqlite, fuelOn('b1', VEH_B.id, 50_000, 8, 6));
    seedExpense(testDb.sqlite, fuelOn('b2', VEH_B.id, 50_320, 8, 11));

    const adv = await repo.getFuelAdvanced(USER.id, rangeAll());
    const winter = adv.seasonalEfficiency.find((s) => s.season === 'Winter');
    const expectedConvertedB = (40 / 1.609344) * 3.785411784; // ≈ 94.07 mi/gal
    const expectedAvg = (30 + expectedConvertedB) / 2; // ≈ 62.04

    expect(winter?.avgEfficiency).toBeCloseTo(expectedAvg, 1);
    expect(winter?.avgEfficiency).not.toBeCloseTo(35, 0); // NOT the raw (30+40)/2 pool
    expect(winter?.fillupCount).toBe(4); // unitless — all four volume-bearing rows
  });

  // #94 DAY-OF-WEEK member FIXED (C72, same Angelo-approved convert-before-pool direction): the
  // getFuelAdvanced dayOfWeekPatterns series sums each fillup's volume per weekday across ALL vehicles —
  // buildDayOfWeekPatterns pooled gal + L raw, skewing avgVolume on a mixed fleet (NORTH_STAR #2).
  // getFuelAdvanced now routes a MIXED-unit fleet through buildConvertedDayOfWeekPatterns (per-row
  // convertVolume). fillupCount (a count) + avgCost ($) are unit-free and unchanged; only avgVolume converts.
  test('dayOfWeek avgVolume converts each fillup volume to the user unit before pooling on a MIXED gal+L fleet', async () => {
    seedUser(testDb.sqlite, USER); // default GALLONS_US
    seedVehicle(testDb.sqlite, VEH_A); // gallons (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports its volume in LITRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'miles', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // All four fillups land on a MONDAY (Jan 1/8/15/22 2024 are Mondays) so they pool into one weekday
    // bucket. A: two 10-GALLON fillups. B: two 8-LITRE fillups (8 L → 8/3.785411784 ≈ 2.113 gal each).
    // Converted avgVolume = (10 + 10 + 2.113 + 2.113)/4 ≈ 6.06 gal; the pre-fix RAW pool would be
    // (10 + 10 + 8 + 8)/4 = 9.0.
    const mon = (day: number) => new Date(2024, 0, day);
    const fuelOn = (
      id: string,
      vid: string,
      mileage: number,
      vol: number,
      day: number
    ): TestExpense => ({
      id,
      vehicleId: vid,
      category: 'fuel',
      expenseAmount: 50,
      date: mon(day),
      mileage,
      volume: vol,
      fuelType: 'Regular',
      missedFillup: false,
    });
    seedExpense(testDb.sqlite, fuelOn('a1', VEH_A.id, 10_000, 10, 1));
    seedExpense(testDb.sqlite, fuelOn('a2', VEH_A.id, 10_300, 10, 8));
    seedExpense(testDb.sqlite, fuelOn('b1', VEH_B.id, 50_000, 8, 15));
    seedExpense(testDb.sqlite, fuelOn('b2', VEH_B.id, 50_320, 8, 22));

    const adv = await repo.getFuelAdvanced(USER.id, rangeAll());
    const monday = adv.dayOfWeekPatterns.find((d) => d.day === 'Monday');
    const litreToGal = 8 / 3.785411784; // ≈ 2.113 gal
    const expectedAvgVolume = (10 + 10 + litreToGal + litreToGal) / 4; // ≈ 6.06 gal

    expect(monday?.avgVolume).toBeCloseTo(expectedAvgVolume, 2);
    expect(monday?.avgVolume).not.toBeCloseTo(9, 1); // NOT the raw (10+10+8+8)/4 pool
    expect(monday?.fillupCount).toBe(4); // unitless count unchanged
    expect(monday?.avgCost).toBeCloseTo(50, 5); // $ unchanged (50 each → avg 50)
  });

  // #94 VEHICLE-RADAR member FIXED (C76, the LAST advanced builder): buildVehicleRadar normalizes each
  // vehicle's gas-MPG (and odometer) via min/max ACROSS the fleet. Pre-fix it normalized RAW per-vehicle
  // values, so a km/L vehicle was ranked against an mpg vehicle by bare magnitude → the efficiency ranking
  // could fully INVERT (a more-efficient metric car scored LOWER). getFuelAdvanced now passes per-vehicle
  // converters so each vehicle's MPG + odometer convert to the user's global units BEFORE the normalize.
  // This is the strongest possible distinguisher: the converted ranking is the OPPOSITE of the raw one.
  test('vehicleRadar fuelEfficiency normalizes CONVERTED gas-MPG so a mixed mi/gal+km/L fleet ranks like-with-like', async () => {
    seedUser(testDb.sqlite, USER); // default MILES / GALLONS_US
    seedVehicle(testDb.sqlite, VEH_A); // miles/gallons (default)
    seedVehicle(testDb.sqlite, VEH_B);
    // VEH_B reports distance in KM and volume in LITRES.
    testDb.sqlite.run('UPDATE vehicles SET unit_preferences = ? WHERE id = ?', [
      JSON.stringify({ distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }),
      VEH_B.id,
    ]);

    // A: 10000→10300 mi on 10 gal = 30 mpg (raw). B: 50000→50360 km on 20 L = 18 km/L (raw), which
    // converts to 18/1.609344×3.785411784 ≈ 42.34 mpg. RAW magnitudes: A 30 > B 18 → A ranks top
    // (fuelEfficiency 100), B bottom (0). CONVERTED: B 42.34 > A 30 → B ranks top, A bottom — the OPPOSITE.
    seedExpense(testDb.sqlite, fillup('a1', VEH_A.id, 10_000, 40, 60, 10));
    seedExpense(testDb.sqlite, fillup('a2', VEH_A.id, 10_300, 40, 30, 10));
    seedExpense(testDb.sqlite, fillup('b1', VEH_B.id, 50_000, 40, 60, 20));
    seedExpense(testDb.sqlite, fillup('b2', VEH_B.id, 50_360, 40, 30, 20));

    const adv = await repo.getFuelAdvanced(USER.id, rangeAll());
    const a = adv.vehicleRadar.find((r) => r.vehicleId === VEH_A.id);
    const b = adv.vehicleRadar.find((r) => r.vehicleId === VEH_B.id);

    // Converted: B (42.34 mpg) is the more-efficient car → it gets the top score, A the bottom.
    expect(b?.fuelEfficiency).toBe(100);
    expect(a?.fuelEfficiency).toBe(0);
    // The pre-fix RAW normalize would have inverted this (A 30 > B 18 → A=100, B=0).
    expect(a?.fuelEfficiency).not.toBe(100);
  });
});
