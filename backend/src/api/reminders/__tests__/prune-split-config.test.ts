import { describe, expect, test } from 'bun:test';
import type { SplitConfig } from '../../../db/types';
import { pruneVehicleFromSplitConfig } from '../split-config-helpers';

describe('pruneVehicleFromSplitConfig — even', () => {
  test('drops the deleted id and keeps the split when two or more legs remain', () => {
    const config: SplitConfig = { method: 'even', vehicleIds: ['a', 'b', 'c'] };
    expect(pruneVehicleFromSplitConfig(config, 'b')).toEqual({
      method: 'even',
      vehicleIds: ['a', 'c'],
    });
  });

  test('collapses to null when only one leg would remain', () => {
    const config: SplitConfig = { method: 'even', vehicleIds: ['a', 'b'] };
    expect(pruneVehicleFromSplitConfig(config, 'b')).toBeNull();
  });

  test('returns the same reference when the deleted id is absent', () => {
    const config: SplitConfig = { method: 'even', vehicleIds: ['a', 'b'] };
    expect(pruneVehicleFromSplitConfig(config, 'zzz')).toBe(config);
  });
});

describe('pruneVehicleFromSplitConfig — absolute', () => {
  test('drops the allocation and keeps the remaining fixed amounts', () => {
    const config: SplitConfig = {
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
    const config: SplitConfig = {
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
    const config: SplitConfig = {
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
    expect(allocations.reduce((s, a) => s + a.percentage, 0)).toBeCloseTo(100, 5);
  });

  test('survivors that all summed to 0% fall back to an even split', () => {
    const config: SplitConfig = {
      method: 'percentage',
      allocations: [
        { vehicleId: 'a', percentage: 0 },
        { vehicleId: 'b', percentage: 0 },
        { vehicleId: 'c', percentage: 100 },
      ],
    };
    const result = pruneVehicleFromSplitConfig(config, 'c');
    const allocations = (result as { allocations: { vehicleId: string; percentage: number }[] })
      .allocations;
    expect(allocations.map((a) => a.percentage)).toEqual([50, 50]);
    expect(allocations.reduce((s, a) => s + a.percentage, 0)).toBeCloseTo(100, 5);
  });

  test('collapses to null when only 1 allocation would remain', () => {
    const config: SplitConfig = {
      method: 'percentage',
      allocations: [
        { vehicleId: 'a', percentage: 40 },
        { vehicleId: 'b', percentage: 60 },
      ],
    };
    expect(pruneVehicleFromSplitConfig(config, 'a')).toBeNull();
  });
});
