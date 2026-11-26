import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../test-helpers/http-client';
import { seedVehicle } from '../../test-helpers/seed';
import { dateInput } from '../validation';

const BAD_DATES: unknown[] = [
  null,
  true,
  false,
  0,
  -1,
  '',
  'true',
  '0',
  '1800-01-01',
  '2999-01-01',
  1,
  1_706_788_800_000,
];

describe('dateInput', () => {
  test.each(BAD_DATES)('rejects %p', (value) => {
    expect(dateInput.safeParse(value).success).toBe(false);
  });

  test('accepts an ISO timestamp, a plain day and a Date', () => {
    expect(dateInput.parse('2024-02-01T12:00:00.000Z').toISOString()).toBe(
      '2024-02-01T12:00:00.000Z'
    );
    expect(dateInput.parse('2024-02-01').toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(dateInput.parse(new Date('1995-06-01T00:00:00.000Z')).getUTCFullYear()).toBe(1995);
  });
});

describe('date fields reject values that would be saved as 1970', () => {
  let ctx: TestApp;
  let vehicleId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    vehicleId = await seedVehicle(ctx);
  }, SETUP_TIMEOUT_MS);
  afterEach(() => ctx.close());

  const bodies: [string, string, (date: unknown, vehicleId: string) => unknown][] = [
    [
      'expense date',
      '/api/v1/expenses',
      (date, id) => ({ vehicleId: id, category: 'misc', expenseAmount: 10, date }),
    ],
    [
      'split expense date',
      '/api/v1/expenses/split',
      (date, id) => ({
        splitConfig: { method: 'even', vehicleIds: [id] },
        category: 'misc',
        totalAmount: 10,
        date,
      }),
    ],
    [
      'odometer recordedAt',
      '/api/v1/odometer/:vehicleId',
      (date) => ({ odometer: 100, recordedAt: date }),
    ],
    [
      'financing startDate',
      '/api/v1/financing/vehicles/:vehicleId/financing',
      (date) => ({
        financingType: 'loan',
        provider: 'TestBank',
        originalAmount: 20000,
        termMonths: 60,
        startDate: date,
        paymentAmount: 400,
        apr: 5,
      }),
    ],
    ['insurance term startDate', '/api/v1/insurance', (date, id) => policyBody(id, date)],
    [
      'insurance claim claimDate',
      '/api/v1/insurance/:policyId/claims',
      (date) => ({ claimDate: date, claimType: 'collision' }),
    ],
    [
      'reminder startDate',
      '/api/v1/reminders',
      (date, id) => ({
        name: 'Inspection',
        type: 'notification',
        frequency: 'yearly',
        startDate: date,
        vehicleIds: [id],
      }),
    ],
    [
      'vehicle purchaseDate',
      '/api/v1/vehicles',
      (date) => ({ make: 'Honda', model: 'Fit', year: 2020, purchaseDate: date }),
    ],
  ];

  function policyBody(id: string, startDate: unknown): unknown {
    return {
      company: 'Acme Mutual',
      terms: [
        {
          startDate,
          endDate: '2025-01-01T00:00:00.000Z',
          vehicleCoverage: { vehicleIds: [id] },
        },
      ],
    };
  }

  async function resolve(route: string): Promise<string> {
    if (!route.includes(':policyId')) return route.replace(':vehicleId', vehicleId);
    const res = await ctx.authed('POST', '/api/v1/insurance', policyBody(vehicleId, '2024-01-01'));
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    return route.replace(':policyId', body.data.id);
  }

  for (const [label, route, body] of bodies) {
    test(`${label} accepts a real date`, async () => {
      const res = await ctx.authed(
        'POST',
        await resolve(route),
        body('2024-02-01T12:00:00.000Z', vehicleId)
      );
      expect(res.status, await res.text()).toBe(201);
    });

    test.each([null, true, 0])(`${label} rejects %p`, async (date) => {
      const res = await ctx.authed('POST', await resolve(route), body(date, vehicleId));
      expect(res.status, await res.text()).toBe(400);
    });
  }

  async function createdId(path: string, body: unknown): Promise<string> {
    const res = await ctx.authed('POST', path, body);
    const parsed = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(parsed)).toBe(201);
    return parsed.data.id;
  }

  test('updates reject the same values', async () => {
    const expenseId = await createdId('/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-02-01T12:00:00.000Z',
    });
    const readingId = await createdId(`/api/v1/odometer/${vehicleId}`, {
      odometer: 100,
      recordedAt: '2024-02-01T12:00:00.000Z',
    });
    const policyRes = await ctx.authed(
      'POST',
      '/api/v1/insurance',
      policyBody(vehicleId, '2024-01-01')
    );
    const policy = await json<DataEnvelope<{ id: string; terms: { id: string }[] }>>(policyRes);
    expect(policyRes.status, JSON.stringify(policy)).toBe(201);
    const termId = policy.data.terms[0]?.id;
    const claimId = await createdId(`/api/v1/insurance/${policy.data.id}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
    });
    const paths: [string, string][] = [
      [`/api/v1/expenses/${expenseId}`, 'date'],
      [`/api/v1/odometer/${readingId}`, 'recordedAt'],
      [`/api/v1/insurance/${policy.data.id}/terms/${termId}`, 'startDate'],
      [`/api/v1/insurance/${policy.data.id}/terms/${termId}`, 'endDate'],
      [`/api/v1/insurance/${policy.data.id}/claims/${claimId}`, 'claimDate'],
    ];
    for (const date of [null, true, 0, '2101-01-01']) {
      for (const [path, field] of paths) {
        const res = await ctx.authed('PUT', path, { [field]: date });
        expect(res.status, `${path} ${field}=${date}: ${await res.text()}`).toBe(400);
      }
    }
    const termPath = `/api/v1/insurance/${policy.data.id}/terms/${termId}`;
    const moved = await ctx.authed('PUT', termPath, { endDate: '2025-06-30T00:00:00.000Z' });
    const movedBody = await json<DataEnvelope<{ terms: { id: string; endDate: string }[] }>>(moved);
    expect(moved.status, JSON.stringify(movedBody)).toBe(200);
    expect(movedBody.data.terms.find((t) => t.id === termId)?.endDate).toBe(
      '2025-06-30T00:00:00.000Z'
    );
    for (const date of [true, 0]) {
      const res = await ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, { purchaseDate: date });
      expect(res.status, `purchaseDate=${date}: ${await res.text()}`).toBe(400);
    }
  });

  test('a stored reminder dated outside the range can still be paused and renamed', async () => {
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Inspection',
      type: 'notification',
      frequency: 'yearly',
      startDate: '2099-06-15',
      vehicleIds: [vehicleId],
    });
    const reminder = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(reminder)).toBe(201);
    const id = reminder.data.reminder.id;
    const farFuture = Date.UTC(2160, 0, 1) / 1000;
    ctx.sqlite
      .query('UPDATE reminders SET start_date = ?, end_date = ? WHERE id = ?')
      .run(farFuture - 1, farFuture, id);
    for (const body of [{ isActive: false }, { name: 'Old reminder' }]) {
      const res = await ctx.authed('PUT', `/api/v1/reminders/${id}`, body);
      expect(res.status, `${JSON.stringify(body)}: ${await res.text()}`).toBe(200);
    }
  });

  test('a vehicle purchaseDate can still be cleared with null', async () => {
    const res = await ctx.authed('PUT', `/api/v1/vehicles/${vehicleId}`, { purchaseDate: null });
    expect(res.status, await res.text()).toBe(200);
  });
});
