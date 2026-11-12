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

describe('updateReminderSchema split-config partial', () => {
  test('a split-config-only update without vehicleIds is accepted', () => {
    const parsed = updateReminderSchema.parse({
      expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
    });
    expect(parsed.expenseSplitConfig).toBeDefined();
  });

  test('a percentage split-config-only update still validates the 100 sum', () => {
    expect(() =>
      updateReminderSchema.parse({
        expenseSplitConfig: {
          method: 'percentage',
          allocations: [
            { vehicleId: 'v1', percentage: 70 },
            { vehicleId: 'v2', percentage: 20 },
          ],
        },
      })
    ).toThrow();
  });

  test('when both vehicleIds and split are sent, a mismatch still fails', () => {
    expect(() =>
      updateReminderSchema.parse({
        vehicleIds: ['v1'],
        expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
      })
    ).toThrow();
  });

  test('when both are sent and they match, it is accepted', () => {
    const parsed = updateReminderSchema.parse({
      vehicleIds: ['v1', 'v2'],
      expenseSplitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
    });
    expect(parsed.expenseSplitConfig).toBeDefined();
  });
});
