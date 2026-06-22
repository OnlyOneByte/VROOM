/**
 * Unit tests for pruneVehicleFromSplitConfig (#88, C48) — the pure renormalizer that drops a deleted
 * vehicle's leg from a reminder's expenseSplitConfig blob.
 *
 * The blob is NOT FK-managed (unlike the reminder_vehicles junction), so a deleted vehicle lingers in it
 * and the next trigger builds a split sibling for the dead vehicleId → FK violation + half-committed
 * surviving legs (C151 async-tx footgun). These pin the renormalize contract per split method.
 */

import { describe, expect, test } from 'bun:test';
import type { ReminderSplitConfig } from '../../../db/types';
import { pruneVehicleFromSplitConfig } from '../split-config-helpers';

describe('pruneVehicleFromSplitConfig — even', () => {
  test('drops the deleted id; ≥2 legs remain → still an even split', () => {
    const config: ReminderSplitConfig = { method: 'even', vehicleIds: ['a', 'b', 'c'] };
    expect(pruneVehicleFromSplitConfig(config, 'b')).toEqual({
      method: 'even',
      vehicleIds: ['a', 'c'],
    });
  });

  test('collapses to null when only 1 leg would remain (caller clears the blob)', () => {
    const config: ReminderSplitConfig = { method: 'even', vehicleIds: ['a', 'b'] };
    expect(pruneVehicleFromSplitConfig(config, 'b')).toBeNull();
  });

  test('returns the SAME reference when the deleted id is absent (no-op → caller skips the write)', () => {
    const config: ReminderSplitConfig = { method: 'even', vehicleIds: ['a', 'b'] };
    expect(pruneVehicleFromSplitConfig(config, 'zzz')).toBe(config);
  });
});

describe('pruneVehicleFromSplitConfig — absolute', () => {
  test('drops the allocation; remaining fixed amounts stand (group total shrinks honestly)', () => {
    const config: ReminderSplitConfig = {
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 30 },
        { vehicleId: 'b', amount: 20 },
        { vehicleId: 'c', amount: 50 },
      ],
    };
    expect(pruneVehicleFromSplitConfig(config, 'b')).toEqual({
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 30 },
        { vehicleId: 'c', amount: 50 },
      ],
    });
  });

  test('collapses to null when only 1 allocation would remain', () => {
    const config: ReminderSplitConfig = {
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 30 },
        { vehicleId: 'b', amount: 20 },
      ],
    };
    expect(pruneVehicleFromSplitConfig(config, 'a')).toBeNull();
  });
});

describe('pruneVehicleFromSplitConfig — percentage (rescale to 100)', () => {
  test('drops the leg + RESCALES survivors proportionally back to 100%', () => {
    // a:25 b:25 c:50; drop b → survivors a:25 c:50 (sum 75) → rescale → a:33.33 c:66.67.
    const config: ReminderSplitConfig = {
      method: 'percentage',
      allocations: [
        { vehicleId: 'a', percentage: 25 },
        { vehicleId: 'b', percentage: 25 },
        { vehicleId: 'c', percentage: 50 },
      ],
    };
    const result = pruneVehicleFromSplitConfig(config, 'b');
    expect(result?.method).toBe('percentage');
    const allocations = (result as { allocations: { vehicleId: string; percentage: number }[] })
      .allocations;
    expect(allocations.map((a) => a.vehicleId)).toEqual(['a', 'c']);
    const byId = new Map(allocations.map((a) => [a.vehicleId, a.percentage]));
    expect(byId.get('a')).toBeCloseTo(33.333, 2);
    expect(byId.get('c')).toBeCloseTo(66.667, 2);
    // The load-bearing invariant: survivors sum back to 100 (refineSplitConfig requires it).
    expect(allocations.reduce((s, a) => s + a.percentage, 0)).toBeCloseTo(100, 5);
  });

  test('survivors that all summed to 0% fall back to an even percentage split (still sums to 100)', () => {
    const config: ReminderSplitConfig = {
      method: 'percentage',
      allocations: [
        { vehicleId: 'a', percentage: 0 },
        { vehicleId: 'b', percentage: 0 },
        { vehicleId: 'c', percentage: 100 },
      ],
    };
    // Drop c → survivors a:0 b:0 (sum 0) → even fallback 50/50.
    const result = pruneVehicleFromSplitConfig(config, 'c');
    const allocations = (result as { allocations: { vehicleId: string; percentage: number }[] })
      .allocations;
    expect(allocations.map((a) => a.percentage)).toEqual([50, 50]);
    expect(allocations.reduce((s, a) => s + a.percentage, 0)).toBeCloseTo(100, 5);
  });

  test('collapses to null when only 1 allocation would remain', () => {
    const config: ReminderSplitConfig = {
      method: 'percentage',
      allocations: [
        { vehicleId: 'a', percentage: 40 },
        { vehicleId: 'b', percentage: 60 },
      ],
    };
    expect(pruneVehicleFromSplitConfig(config, 'a')).toBeNull();
  });
});
