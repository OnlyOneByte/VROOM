import { describe, expect, test } from 'bun:test';
import { type SplitConfig, splitConfigVehicleIds } from '../validation';

describe('splitConfigVehicleIds — vehicleId extraction across split methods', () => {
  test('even → returns vehicleIds verbatim', () => {
    expect(splitConfigVehicleIds({ method: 'even', vehicleIds: ['a', 'b', 'c'] })).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  test('absolute → maps the allocation vehicleIds', () => {
    const config: SplitConfig = {
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 30 },
        { vehicleId: 'b', amount: 20 },
      ],
    };
    expect(splitConfigVehicleIds(config)).toEqual(['a', 'b']);
  });

  test('percentage → maps the allocation vehicleIds', () => {
    const config: SplitConfig = {
      method: 'percentage',
      allocations: [
        { vehicleId: 'x', percentage: 60 },
        { vehicleId: 'y', percentage: 40 },
      ],
    };
    expect(splitConfigVehicleIds(config)).toEqual(['x', 'y']);
  });

  test('de-dupes a vehicle named twice (the callers relied on this Set behavior)', () => {
    const dup: SplitConfig = {
      method: 'absolute',
      allocations: [
        { vehicleId: 'a', amount: 10 },
        { vehicleId: 'a', amount: 5 },
        { vehicleId: 'b', amount: 5 },
      ],
    };
    expect(splitConfigVehicleIds(dup)).toEqual(['a', 'b']);
    expect(splitConfigVehicleIds({ method: 'even', vehicleIds: ['a', 'a', 'b'] })).toEqual([
      'a',
      'b',
    ]);
  });
});
