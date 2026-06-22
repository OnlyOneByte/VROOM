/**
 * Direct unit net for splitConfigVehicleIds (C50 arch-extract → guard-pin). This was a local un-exported
 * helper in expenses/routes.ts, hand-copied inline at 3 sites (the route's ownership loop, the expense
 * repo's validateVehicleOwnership, the reminder validator's split-vs-vehicleIds check). C50 lifted it into
 * expenses/validation.ts as ONE source of truth + routed all three through it. The arch-extract→guard-pin
 * standing pattern (C17→C18 averageConsecutiveMpg, C23 buildSplitConfig): pin the newly-shared helper
 * directly so a future regression is caught at the helper, not only via a caller.
 */

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
