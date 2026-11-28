import { describe, expect, test } from 'bun:test';
import { repos } from '../../../app-context';
import { useTestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

describe('raw-SQL odometer reads', () => {
  const ctx = useTestApp();

  async function seedReadings(): Promise<string> {
    const vehicleId = await seedVehicle(ctx());
    for (const [odometer, recordedAt] of [
      [12000, '2024-05-01T00:00:00.000Z'],
      [15500, '2024-06-01T00:00:00.000Z'],
    ] as const) {
      const res = await ctx().authed('POST', `/api/v1/odometer/${vehicleId}`, {
        odometer,
        recordedAt,
      });
      expect(res.status).toBe(201);
    }
    await repos().expenses.create({
      vehicleId,
      userId: ctx().user.id,
      category: 'fuel',
      date: new Date(Date.UTC(2024, 5, 15, 12)),
      expenseAmount: 4_000,
      mileage: 16200,
    } as Parameters<ReturnType<typeof repos>['expenses']['create']>[0]);
    return vehicleId;
  }

  test('the current odometer is the highest reading across entries and expenses', async () => {
    const vehicleId = await seedReadings();
    expect(await repos().odometer.getCurrentOdometer(vehicleId, ctx().user.id)).toBe(16200);
    expect(await repos().odometer.getCurrentOdometer('missing', ctx().user.id)).toBeNull();
  });

  test('the history lists both sources, newest first, with a total', async () => {
    const vehicleId = await seedReadings();
    const history = await repos().odometer.getHistory(vehicleId, ctx().user.id);
    expect(history.totalCount).toBe(3);
    expect(history.data.map((entry) => [entry.odometer, entry.source])).toEqual([
      [16200, 'expense'],
      [15500, 'manual'],
      [12000, 'manual'],
    ]);
  });
});
