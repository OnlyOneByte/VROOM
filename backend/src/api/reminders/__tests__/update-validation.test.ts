/**
 * Regression guard: the reminder pause/resume toggle sends
 * PUT { isActive: false|true }. If isActive is not part of the update schema,
 * Zod strips it and the toggle silently no-ops (the bug an E2E caught).
 *
 * These tests pin that updateReminderSchema accepts and preserves isActive,
 * and that createReminderSchema still treats it as optional.
 */

import { describe, expect, test } from 'bun:test';
import { createReminderSchema, updateReminderSchema } from '../validation';

describe('updateReminderSchema isActive', () => {
  test('preserves isActive:false (pause)', () => {
    const parsed = updateReminderSchema.parse({ isActive: false });
    expect(parsed.isActive).toBe(false);
  });

  test('preserves isActive:true (resume)', () => {
    const parsed = updateReminderSchema.parse({ isActive: true });
    expect(parsed.isActive).toBe(true);
  });

  test('still allows partial updates without isActive', () => {
    const parsed = updateReminderSchema.parse({ name: 'Renamed' });
    expect(parsed.name).toBe('Renamed');
    expect(parsed.isActive).toBeUndefined();
  });

  test('rejects a non-boolean isActive', () => {
    expect(() => updateReminderSchema.parse({ isActive: 'yes' as unknown as boolean })).toThrow();
  });
});

describe('createReminderSchema isActive', () => {
  test('isActive is optional on create (DB default applies)', () => {
    const parsed = createReminderSchema.parse({
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2026-01-01T00:00:00.000Z',
      vehicleIds: ['veh-1'],
    });
    expect(parsed.isActive).toBeUndefined();
  });

  test('isActive is accepted on create when provided', () => {
    const parsed = createReminderSchema.parse({
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2026-01-01T00:00:00.000Z',
      vehicleIds: ['veh-1'],
      isActive: false,
    });
    expect(parsed.isActive).toBe(false);
  });
});

// #73 (C218): refineSplitConfig's split-vs-vehicleIds MATCH check is a cross-field invariant. On a
// PARTIAL update that changes only the split config and OMITS vehicleIds, the old unconditional check
// compared the split's IDs against an undefined vehicleIds (∅) and 400'd every legitimate
// split-config-only edit. The match check must be guarded on vehicleIds presence; the route's merged
// re-parse still catches a genuine mismatch against the full object. The sum checks stay unconditional.
describe('updateReminderSchema split-config partial (#73)', () => {
  test('a split-config-only update WITHOUT vehicleIds is ACCEPTED (the regression)', () => {
    const parsed = updateReminderSchema.parse({
      expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
    });
    expect(parsed.expenseSplitConfig).toBeDefined();
  });

  test('a percentage split-config-only update still validates the 100-sum (vehicleIds-independent)', () => {
    // No vehicleIds, but the sum check must still fire — proves the fix didn't disable it.
    expect(() =>
      updateReminderSchema.parse({
        expenseSplitConfig: {
          method: 'percentage',
          allocations: [
            { vehicleId: 'v1', percentage: 70 },
            { vehicleId: 'v2', percentage: 20 }, // sums to 90 ≠ 100
          ],
        },
      })
    ).toThrow();
  });

  test('when BOTH vehicleIds + split are sent, a genuine mismatch STILL fails (invariant intact)', () => {
    expect(() =>
      updateReminderSchema.parse({
        vehicleIds: ['v1'],
        expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
      })
    ).toThrow();
  });

  test('when BOTH are sent and they MATCH, it is accepted', () => {
    const parsed = updateReminderSchema.parse({
      vehicleIds: ['v1', 'v2'],
      expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
    });
    expect(parsed.expenseSplitConfig).toBeDefined();
  });
});
