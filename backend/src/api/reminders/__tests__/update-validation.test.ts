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
