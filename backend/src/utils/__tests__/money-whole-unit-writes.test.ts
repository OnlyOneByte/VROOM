import { beforeEach, describe, expect, test } from 'bun:test';
import { type DataEnvelope, json, useTestApp } from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';

const app = useTestApp();

beforeEach(async () => {
  const res = await app().authed('PUT', '/api/v1/settings', { currencyUnit: 'JPY' });
  expect(res.status).toBe(200);
});

describe('edits compare like units when the currency has no decimals', () => {
  test('a split leg keeps its amount and only its description changes', async () => {
    const a = await seedVehicle(app(), { make: 'Honda', model: 'Civic', year: 2021 });
    const b = await seedVehicle(app(), { make: 'Toyota', model: 'Camry', year: 2022 });
    const split = await app().authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [a, b] },
      category: 'maintenance',
      date: '2024-06-01T12:00:00.000Z',
      totalAmount: 1200,
    });
    const legs = (await json<DataEnvelope<{ siblings: { id: string }[] }>>(split)).data.siblings;
    const res = await app().authed('PUT', `/api/v1/expenses/${legs[0]?.id}`, {
      expenseAmount: 600,
      description: 'new',
    });
    expect(res.status, await res.text()).toBe(200);
  });

  test('an absolute-split reminder accepts its unchanged amount', async () => {
    const a = await seedVehicle(app(), { make: 'Honda', model: 'Civic', year: 2021 });
    const b = await seedVehicle(app(), { make: 'Toyota', model: 'Camry', year: 2022 });
    const created = await app().authed('POST', '/api/v1/reminders', {
      name: 'Shared insurance',
      type: 'expense',
      expenseCategory: 'financial',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [a, b],
      expenseAmount: 1200,
      expenseSplitConfig: {
        method: 'absolute',
        allocations: [
          { vehicleId: a, amount: 600 },
          { vehicleId: b, amount: 600 },
        ],
      },
    });
    const id = (await json<DataEnvelope<{ reminder: { id: string } }>>(created)).data.reminder.id;
    const res = await app().authed('PUT', `/api/v1/reminders/${id}`, { expenseAmount: 1200 });
    expect(res.status, await res.text()).toBe(200);
  });
});
