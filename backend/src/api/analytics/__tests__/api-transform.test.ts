/**
 * money-cents-migration T6 — analytics display-edge converters (api-transform.ts).
 *
 * These guard the cents→dollars projection applied at the analytics response boundary. The load-bearing
 * case (C17.5): `fuelAdvancedToApi` must convert the REAL money fields (dayOfWeekPatterns.avgCost,
 * monthlyCostHeatmap.*) but must NOT touch `vehicleRadar.maintenanceCost`/`annualCost` — despite their
 * cost-y names, those are normalizeScore() 0-100 RADAR SCORES (buildVehicleRadar), and a /100 would
 * corrupt the chart (80 → 0.8). A C17 bug converted them; this pins the correct behavior so it can't return.
 */

import { describe, expect, test } from 'bun:test';
import {
  crossVehicleToApi,
  financingToApi,
  fuelAdvancedToApi,
  fuelStatsToApi,
  quickStatsToApi,
  vehicleTcoToApi,
} from '../api-transform';
import type {
  CrossVehicleData,
  FinancingData,
  FuelAdvancedData,
  FuelStatsData,
  QuickStatsData,
  VehicleTCOData,
} from '../repository';

describe('analytics api-transform: money cents→dollars, non-money untouched', () => {
  test('quickStats: ytdSpending cents→dollars; counts/efficiency/score untouched', () => {
    const d: QuickStatsData = {
      vehicleCount: 3,
      ytdSpending: 123456, // $1234.56
      avgEfficiency: 28.5,
      fleetHealthScore: 87,
      units: { distanceUnit: 'mi', volumeUnit: 'gal', chargeUnit: 'kWh' },
    };
    const r = quickStatsToApi(d);
    expect(r.ytdSpending).toBe(1234.56);
    expect(r.vehicleCount).toBe(3); // count — untouched
    expect(r.avgEfficiency).toBe(28.5); // mi/gal — untouched
    expect(r.fleetHealthScore).toBe(87); // score — untouched
  });

  test('fuelAdvanced: vehicleRadar SCORES (maintenanceCost/annualCost) are NOT money — left as 0-100', () => {
    const d = {
      maintenanceTimeline: [],
      seasonalEfficiency: [{ season: 'Summer', avgEfficiency: 30, fillupCount: 4 }],
      vehicleRadar: [
        {
          vehicleId: 'v1',
          vehicleName: 'Camry',
          fuelEfficiency: 75, // score
          maintenanceCost: 80, // SCORE 0-100, NOT money
          reliability: 90, // score
          annualCost: 60, // SCORE 0-100, NOT money
          mileage: 50, // score
        },
      ],
      dayOfWeekPatterns: [{ day: 'Mon', fillupCount: 2, avgCost: 5000, avgVolume: 12 }],
      monthlyCostHeatmap: [
        {
          month: '2024-01',
          fuel: 10000,
          maintenance: 20000,
          financial: 30000,
          regulatory: 0,
          enhancement: 0,
          misc: 500,
        },
      ],
      fillupIntervals: [{ intervalLabel: '0-7d', count: 3 }],
    } as FuelAdvancedData;
    const r = fuelAdvancedToApi(d);
    // RADAR SCORES: byte-for-byte unchanged (the C17.5 bug divided these by 100).
    expect(r.vehicleRadar[0].maintenanceCost).toBe(80);
    expect(r.vehicleRadar[0].annualCost).toBe(60);
    expect(r.vehicleRadar[0].fuelEfficiency).toBe(75);
    expect(r.vehicleRadar[0].reliability).toBe(90);
    expect(r.vehicleRadar[0].mileage).toBe(50);
    // REAL money: converted.
    expect(r.dayOfWeekPatterns[0].avgCost).toBe(50); // 5000c → $50
    expect(r.monthlyCostHeatmap[0].fuel).toBe(100);
    expect(r.monthlyCostHeatmap[0].maintenance).toBe(200);
    expect(r.monthlyCostHeatmap[0].financial).toBe(300);
    expect(r.monthlyCostHeatmap[0].misc).toBe(5);
    // efficiency untouched.
    expect(r.seasonalEfficiency[0].avgEfficiency).toBe(30);
  });

  test('fuelStats: cost + cents-per-unit ratios convert; volume/efficiency/distance untouched', () => {
    const d = {
      fillups: { currentYear: 10, previousYear: 8, currentMonth: 1, previousMonth: 2 },
      volume: { currentYear: 100, previousYear: 90, currentMonth: 10, previousMonth: 12 },
      fuelConsumption: { avgEfficiency: 28, bestEfficiency: 35, worstEfficiency: 20 },
      fillupDetails: { avgVolume: 10, minVolume: 5, maxVolume: 15 },
      averageCost: {
        perFillup: 4500, // $45
        bestCostPerDistance: 12, // 12c/mi → $0.12
        worstCostPerDistance: 30,
        avgCostPerDay: 800,
      },
      distance: { totalDistance: 1000, avgPerDay: 30, avgPerMonth: 900 },
      monthlyConsumption: [{ month: '2024-01', efficiency: 28, volume: 40 }],
      gasPriceHistory: [{ date: '2024-01-01', fuelType: 'regular', pricePerVolume: 350 }], // $3.50/gal
      fillupCostByVehicle: [{ month: '2024-01', vehicleId: 'v1', vehicleName: 'C', avgCost: 5000 }],
      odometerProgression: [
        { month: '2024-01', vehicleId: 'v1', vehicleName: 'C', mileage: 42000 },
      ],
      costPerDistance: [
        { month: '2024-01', vehicleId: 'v1', vehicleName: 'C', costPerDistance: 15 },
      ],
    } as FuelStatsData;
    const r = fuelStatsToApi(d);
    expect(r.averageCost.perFillup).toBe(45);
    expect(r.averageCost.bestCostPerDistance).toBe(0.12);
    expect(r.gasPriceHistory[0].pricePerVolume).toBe(3.5);
    expect(r.fillupCostByVehicle[0].avgCost).toBe(50);
    expect(r.costPerDistance[0].costPerDistance).toBe(0.15);
    // non-money untouched
    expect(r.volume.currentYear).toBe(100);
    expect(r.fuelConsumption.avgEfficiency).toBe(28);
    expect(r.distance.totalDistance).toBe(1000);
    expect(r.odometerProgression[0].mileage).toBe(42000);
  });

  test('financing: payments/balances/interest convert; apr (percent) untouched', () => {
    const d = {
      summary: {
        totalMonthlyPayments: 50000,
        remainingBalance: 2000000,
        monthlyInterestEstimate: 8333,
        activeCount: 1,
        loanCount: 1,
        leaseCount: 0,
      },
      vehicleDetails: [
        {
          vehicleId: 'v1',
          vehicleName: 'C',
          financingType: 'loan',
          monthlyPayment: 50000,
          remainingBalance: 2000000,
          apr: 5.5,
          monthlyInterestEstimate: 8333,
          monthsRemaining: 40,
        },
      ],
      monthlyTimeline: [
        { month: '2024-01', vehicles: [{ vehicleId: 'v1', vehicleName: 'C', amount: 50000 }] },
      ],
      typeDistribution: [{ type: 'loan', value: 50000, count: 1 }],
      loanBreakdown: [{ month: '2024-01', interest: 8333, principal: 41667 }],
    } as FinancingData;
    const r = financingToApi(d);
    expect(r.summary.totalMonthlyPayments).toBe(500);
    expect(r.summary.remainingBalance).toBe(20000);
    expect(r.vehicleDetails[0].monthlyPayment).toBe(500);
    expect(r.vehicleDetails[0].apr).toBe(5.5); // percent — untouched
    expect(r.monthlyTimeline[0].vehicles[0].amount).toBe(500);
    expect(r.typeDistribution[0].value).toBe(500);
    expect(r.typeDistribution[0].count).toBe(1); // count — untouched
    expect(r.loanBreakdown[0].interest).toBe(83.33);
    expect(r.loanBreakdown[0].principal).toBe(416.67);
  });

  test('crossVehicle: amounts/costPerDistance convert; percentage/efficiency untouched', () => {
    const d = {
      monthlyExpenseTrends: [{ month: '2024-01', amount: 12345 }],
      expenseByCategory: [{ category: 'fuel', amount: 50000, percentage: 42.5 }],
      vehicleCostComparison: [
        { vehicleId: 'v1', vehicleName: 'C', totalCost: 100000, costPerDistance: 25 },
      ],
      fuelEfficiencyComparison: [
        { month: '2024-01', vehicles: [{ vehicleId: 'v1', vehicleName: 'C', efficiency: 28 }] },
      ],
      units: { distanceUnit: 'mi', volumeUnit: 'gal', chargeUnit: 'kWh' },
    } as CrossVehicleData;
    const r = crossVehicleToApi(d);
    expect(r.monthlyExpenseTrends[0].amount).toBe(123.45);
    expect(r.expenseByCategory[0].amount).toBe(500);
    expect(r.expenseByCategory[0].percentage).toBe(42.5); // percent — untouched
    expect(r.vehicleCostComparison[0].totalCost).toBe(1000);
    expect(r.vehicleCostComparison[0].costPerDistance).toBe(0.25);
    expect(r.fuelEfficiencyComparison[0].vehicles[0].efficiency).toBe(28); // untouched
  });

  test('vehicleTco: all cost buckets + ratios convert; null purchasePrice stays null', () => {
    const d = {
      vehicleId: 'v1',
      vehicleName: 'C',
      purchasePrice: null,
      financingInterest: 10000,
      insuranceCost: 20000,
      fuelCost: 30000,
      maintenanceCost: 40000,
      otherCosts: 5000,
      totalCost: 105000,
      ownershipMonths: 12,
      totalDistance: 12000,
      costPerDistance: 9,
      costPerMonth: 8750,
      monthlyTrend: [
        { month: '2024-01', financing: 1000, insurance: 2000, fuel: 3000, maintenance: 4000 },
      ],
    } as VehicleTCOData;
    const r = vehicleTcoToApi(d);
    expect(r.purchasePrice).toBeNull(); // null money stays null
    expect(r.totalCost).toBe(1050);
    expect(r.costPerMonth).toBe(87.5);
    expect(r.costPerDistance).toBe(0.09);
    expect(r.monthlyTrend[0].fuel).toBe(30);
    expect(r.ownershipMonths).toBe(12); // count — untouched
    expect(r.totalDistance).toBe(12000); // distance — untouched
  });
});
