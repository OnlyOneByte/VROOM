import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../test-helpers/http-client';
import { createInvitee } from '../test-helpers/invitee';
import { seedVehicle } from '../test-helpers/seed';
import type { VehicleAccessMode } from '../utils/vehicle-access';

type Actor = 'owner' | 'editor' | 'viewer' | 'stranger';

interface Fixture {
  vehicleId: string;
  expenseId: string;
  odometerId: string;
  financingId: string;
  policyId: string;
  termId: string;
  reminderId: string;
  tripId: string;
}

interface RouteCase {
  name: string;
  mode: VehicleAccessMode;
  request: (fx: Fixture) => [method: string, path: string, body?: unknown];
  expectInBody?: (fx: Fixture) => string;
  authorized?: boolean;
  allowed?: readonly Actor[];
}

const ALLOWED: Record<VehicleAccessMode, readonly Actor[]> = {
  read: ['owner', 'editor', 'viewer'],
  write: ['owner', 'editor'],
  owner: ['owner'],
};

const EXPENSE_BODY = {
  category: 'maintenance',
  expenseAmount: 25,
  date: '2024-06-01T00:00:00.000Z',
  description: 'access-table expense',
};

const FINANCING_BODY = {
  financingType: 'loan',
  provider: 'Bank',
  originalAmount: 1000,
  termMonths: 12,
  startDate: '2024-01-01T00:00:00.000Z',
  paymentAmount: 100,
  paymentFrequency: 'monthly',
};

const policyBody = (vehicleId: string) => ({
  company: 'Mutual',
  terms: [
    {
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2025-01-01T00:00:00.000Z',
      vehicleCoverage: { vehicleIds: [vehicleId] },
    },
  ],
});

const RANGE = 'startDate=1704067200&endDate=1735689600';

const ROUTES: RouteCase[] = [
  {
    name: 'GET /vehicles/:id',
    mode: 'read',
    request: (fx) => ['GET', `/vehicles/${fx.vehicleId}`],
    expectInBody: (fx) => fx.vehicleId,
  },
  {
    name: 'GET /vehicles/:id/stats',
    mode: 'read',
    request: (fx) => ['GET', `/vehicles/${fx.vehicleId}/stats`],
  },
  {
    name: 'PUT /vehicles/:id',
    mode: 'owner',
    authorized: true,
    request: (fx) => ['PUT', `/vehicles/${fx.vehicleId}`, { nickname: 'Renamed' }],
  },
  {
    name: 'DELETE /vehicles/:id',
    mode: 'owner',
    authorized: true,
    request: (fx) => ['DELETE', `/vehicles/${fx.vehicleId}`],
  },
  {
    name: 'POST /shares',
    mode: 'owner',
    authorized: true,
    request: (fx) => [
      'POST',
      '/shares',
      { vehicleId: fx.vehicleId, email: 'new-person@test.com', level: 'viewer' },
    ],
  },
  {
    name: 'GET /expenses?vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/expenses?vehicleId=${fx.vehicleId}`],
    expectInBody: (fx) => fx.expenseId,
  },
  {
    name: 'GET /expenses/summary?vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/expenses/summary?vehicleId=${fx.vehicleId}`],
  },
  {
    name: 'GET /expenses/export?vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/expenses/export?vehicleId=${fx.vehicleId}`],
    expectInBody: () => 'access-table expense',
  },
  {
    name: 'GET /expenses/:id',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/expenses/${fx.expenseId}`],
    expectInBody: (fx) => fx.expenseId,
  },
  {
    name: 'POST /expenses',
    mode: 'write',
    authorized: true,
    request: (fx) => ['POST', '/expenses', { ...EXPENSE_BODY, vehicleId: fx.vehicleId }],
  },
  {
    name: 'PUT /expenses/:id',
    mode: 'write',
    authorized: true,
    request: (fx) => ['PUT', `/expenses/${fx.expenseId}`, { description: 'edited' }],
  },
  {
    name: 'DELETE /expenses/:id',
    mode: 'write',
    authorized: true,
    allowed: ['owner'],
    request: (fx) => ['DELETE', `/expenses/${fx.expenseId}`],
  },
  {
    name: 'GET /financing/vehicles/:id/financing',
    mode: 'owner',
    authorized: true,
    request: (fx) => ['GET', `/financing/vehicles/${fx.vehicleId}/financing`],
    expectInBody: (fx) => fx.financingId,
  },
  {
    name: 'POST /financing/vehicles/:id/financing',
    mode: 'owner',
    authorized: true,
    request: (fx) => ['POST', `/financing/vehicles/${fx.vehicleId}/financing`, FINANCING_BODY],
  },
  {
    name: 'PATCH /financing/:id/payment-amount',
    mode: 'owner',
    authorized: true,
    request: (fx) => [
      'PATCH',
      `/financing/${fx.financingId}/payment-amount`,
      { paymentAmount: 120 },
    ],
  },
  {
    name: 'PUT /financing/:id/payoff',
    mode: 'owner',
    authorized: true,
    request: (fx) => ['PUT', `/financing/${fx.financingId}/payoff`],
  },
  {
    name: 'DELETE /financing/:id',
    mode: 'owner',
    authorized: true,
    request: (fx) => ['DELETE', `/financing/${fx.financingId}`],
  },
  {
    name: 'GET /insurance/vehicles/:id/policies',
    mode: 'read',
    request: (fx) => ['GET', `/insurance/vehicles/${fx.vehicleId}/policies`],
    expectInBody: (fx) => fx.policyId,
  },
  {
    name: 'POST /insurance',
    mode: 'owner',
    request: (fx) => ['POST', '/insurance', policyBody(fx.vehicleId)],
  },
  {
    name: 'POST /insurance/:id/terms',
    mode: 'owner',
    request: (fx) => [
      'POST',
      `/insurance/${fx.policyId}/terms`,
      {
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
        vehicleCoverage: { vehicleIds: [fx.vehicleId] },
      },
    ],
  },
  {
    name: 'PUT /insurance/:id/terms/:termId',
    mode: 'owner',
    request: (fx) => [
      'PUT',
      `/insurance/${fx.policyId}/terms/${fx.termId}`,
      { policyNumber: 'P-2' },
    ],
  },
  {
    name: 'DELETE /insurance/:id/terms/:termId',
    mode: 'owner',
    request: (fx) => ['DELETE', `/insurance/${fx.policyId}/terms/${fx.termId}`],
  },
  {
    name: 'GET /reminders?vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/reminders?vehicleId=${fx.vehicleId}`],
    expectInBody: (fx) => fx.reminderId,
  },
  {
    name: 'POST /reminders',
    mode: 'write',
    authorized: true,
    request: (fx) => [
      'POST',
      '/reminders',
      {
        name: 'Oil change',
        type: 'notification',
        frequency: 'custom',
        intervalValue: 1,
        intervalUnit: 'month',
        startDate: '2024-01-01T00:00:00.000Z',
        vehicleIds: [fx.vehicleId],
      },
    ],
  },
  {
    name: 'GET /odometer/:vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/odometer/${fx.vehicleId}`],
  },
  {
    name: 'GET /odometer/:vehicleId/history',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/odometer/${fx.vehicleId}/history`],
    expectInBody: (fx) => fx.odometerId,
  },
  {
    name: 'GET /odometer/entry/:id',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/odometer/entry/${fx.odometerId}`],
    expectInBody: (fx) => fx.odometerId,
  },
  {
    name: 'POST /odometer/:vehicleId',
    mode: 'write',
    authorized: true,
    request: (fx) => [
      'POST',
      `/odometer/${fx.vehicleId}`,
      { odometer: 32000, recordedAt: '2024-07-01T00:00:00.000Z' },
    ],
  },
  {
    name: 'PUT /odometer/:id',
    mode: 'write',
    authorized: true,
    request: (fx) => ['PUT', `/odometer/${fx.odometerId}`, { odometer: 31500 }],
  },
  {
    name: 'DELETE /odometer/:id',
    mode: 'write',
    authorized: true,
    allowed: ['owner'],
    request: (fx) => ['DELETE', `/odometer/${fx.odometerId}`],
  },
  {
    name: 'POST /trips',
    mode: 'write',
    authorized: true,
    request: (fx) => [
      'POST',
      '/trips',
      {
        vehicleId: fx.vehicleId,
        startOdometer: 40000,
        endOdometer: 40100,
        tripDate: '2024-08-01T00:00:00.000Z',
        purpose: 'business',
      },
    ],
  },
  {
    name: 'GET /trips?vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/trips?vehicleId=${fx.vehicleId}`],
    expectInBody: (fx) => fx.tripId,
  },
  {
    name: 'GET /trips/summary?vehicleId',
    mode: 'read',
    authorized: true,
    request: (fx) => ['GET', `/trips/summary?vehicleId=${fx.vehicleId}`],
    expectInBody: () => '"tripCount":1',
  },
  {
    name: 'GET /analytics/fuel-stats?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/analytics/fuel-stats?vehicleId=${fx.vehicleId}&${RANGE}`],
  },
  {
    name: 'GET /analytics/fuel-advanced?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/analytics/fuel-advanced?vehicleId=${fx.vehicleId}&${RANGE}`],
  },
  {
    name: 'GET /analytics/vehicle-health?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/analytics/vehicle-health?vehicleId=${fx.vehicleId}`],
  },
  {
    name: 'GET /analytics/vehicle-tco?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/analytics/vehicle-tco?vehicleId=${fx.vehicleId}`],
  },
  {
    name: 'GET /analytics/vehicle-expenses?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/analytics/vehicle-expenses?vehicleId=${fx.vehicleId}&${RANGE}`],
  },
  {
    name: 'GET /analytics/fuel-efficiency?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/analytics/fuel-efficiency?vehicleId=${fx.vehicleId}`],
  },
];

let ctx: TestApp;
let fx: Fixture;
let as: Record<Actor, RequestFn>;

beforeEach(async () => {
  ctx = await createTestApp();
  const vehicleId = await seedVehicle(ctx);
  const created = await ctx.authed('POST', '/api/v1/expenses', { ...EXPENSE_BODY, vehicleId });
  const expense = await json<DataEnvelope<{ id: string }>>(created);
  expect(created.status, JSON.stringify(expense)).toBe(201);
  const reading = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
    odometer: 31000,
    recordedAt: '2024-06-02T00:00:00.000Z',
  });
  const odometer = await json<DataEnvelope<{ id: string }>>(reading);
  expect(reading.status, JSON.stringify(odometer)).toBe(201);
  const financingRes = await ctx.authed(
    'POST',
    `/api/v1/financing/vehicles/${vehicleId}/financing`,
    FINANCING_BODY
  );
  const financing = await json<DataEnvelope<{ id: string }>>(financingRes);
  expect(financingRes.status, JSON.stringify(financing)).toBe(201);
  const policyRes = await ctx.authed('POST', '/api/v1/insurance', policyBody(vehicleId));
  const policy = await json<DataEnvelope<{ id: string; terms: { id: string }[] }>>(policyRes);
  expect(policyRes.status, JSON.stringify(policy)).toBe(201);
  const reminderRes = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Tyre check',
    type: 'notification',
    frequency: 'custom',
    intervalValue: 1,
    intervalUnit: 'month',
    startDate: '2024-01-01T00:00:00.000Z',
    vehicleIds: [vehicleId],
  });
  const reminder = await json<DataEnvelope<{ reminder: { id: string } }>>(reminderRes);
  expect(reminderRes.status, JSON.stringify(reminder)).toBe(201);
  const tripRes = await ctx.authed('POST', '/api/v1/trips', {
    vehicleId,
    startOdometer: 35000,
    endOdometer: 35100,
    tripDate: '2024-07-15T00:00:00.000Z',
    purpose: 'business',
  });
  const trip = await json<DataEnvelope<{ id: string }>>(tripRes);
  expect(tripRes.status, JSON.stringify(trip)).toBe(201);
  fx = {
    vehicleId,
    expenseId: expense.data.id,
    odometerId: odometer.data.id,
    financingId: financing.data.id,
    policyId: policy.data.id,
    termId: policy.data.terms[0].id,
    reminderId: reminder.data.reminder.id,
    tripId: trip.data.id,
  };

  const editor = await createInvitee(ctx, 'access-editor');
  const viewer = await createInvitee(ctx, 'access-viewer');
  const stranger = await createInvitee(ctx, 'access-stranger');
  await editor.acceptShare(vehicleId, 'editor');
  await viewer.acceptShare(vehicleId, 'viewer');
  as = {
    owner: ctx.authed,
    editor: editor.request,
    viewer: viewer.request,
    stranger: stranger.request,
  };
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

describe('every vehicle-scoped route enforces owner / editor / viewer / stranger access', () => {
  for (const route of ROUTES) {
    for (const actor of ['owner', 'editor', 'viewer', 'stranger'] as const) {
      const allowed = (route.allowed ?? ALLOWED[route.mode]).includes(actor);
      const denied = route.authorized && actor !== 'stranger' ? 403 : 404;
      test(`${route.name} as ${actor} → ${allowed ? 'allowed' : denied}`, async () => {
        const [method, path, body] = route.request(fx);
        const res = await as[actor](method, `/api/v1${path}`, body);
        if (allowed) {
          const text = await res.text();
          expect(res.status, text).toBeLessThan(300);
          if (route.expectInBody) expect(text).toContain(route.expectInBody(fx));
        } else {
          expect(res.status).toBe(denied);
        }
      });
    }
  }
});
