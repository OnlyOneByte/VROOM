import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
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
}

interface RouteCase {
  name: string;
  mode: VehicleAccessMode;
  request: (fx: Fixture) => [method: string, path: string, body?: unknown];
  returnsOwnerRow?: (fx: Fixture) => string;
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

const ROUTES: RouteCase[] = [
  {
    name: 'GET /vehicles/:id',
    mode: 'read',
    request: (fx) => ['GET', `/vehicles/${fx.vehicleId}`],
  },
  {
    name: 'GET /vehicles/:id/stats',
    mode: 'read',
    request: (fx) => ['GET', `/vehicles/${fx.vehicleId}/stats`],
  },
  {
    name: 'PUT /vehicles/:id',
    mode: 'owner',
    request: (fx) => ['PUT', `/vehicles/${fx.vehicleId}`, { nickname: 'Renamed' }],
  },
  {
    name: 'DELETE /vehicles/:id',
    mode: 'owner',
    request: (fx) => ['DELETE', `/vehicles/${fx.vehicleId}`],
  },
  {
    name: 'POST /shares',
    mode: 'owner',
    request: (fx) => [
      'POST',
      '/shares',
      { vehicleId: fx.vehicleId, email: 'new-person@test.com', level: 'viewer' },
    ],
  },
  {
    name: 'GET /expenses?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/expenses?vehicleId=${fx.vehicleId}`],
    returnsOwnerRow: (fx) => fx.expenseId,
  },
  {
    name: 'GET /expenses/summary?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/expenses/summary?vehicleId=${fx.vehicleId}`],
  },
  {
    name: 'GET /expenses/export?vehicleId',
    mode: 'read',
    request: (fx) => ['GET', `/expenses/export?vehicleId=${fx.vehicleId}`],
  },
  {
    name: 'GET /expenses/:id',
    mode: 'read',
    request: (fx) => ['GET', `/expenses/${fx.expenseId}`],
  },
  {
    name: 'POST /expenses',
    mode: 'write',
    request: (fx) => ['POST', '/expenses', { ...EXPENSE_BODY, vehicleId: fx.vehicleId }],
  },
  {
    name: 'PUT /expenses/:id',
    mode: 'write',
    request: (fx) => ['PUT', `/expenses/${fx.expenseId}`, { description: 'edited' }],
  },
  {
    name: 'DELETE /expenses/:id',
    mode: 'write',
    request: (fx) => ['DELETE', `/expenses/${fx.expenseId}`],
  },
  {
    name: 'GET /financing/vehicles/:id/financing',
    mode: 'owner',
    request: (fx) => ['GET', `/financing/vehicles/${fx.vehicleId}/financing`],
  },
  {
    name: 'POST /financing/vehicles/:id/financing',
    mode: 'owner',
    request: (fx) => ['POST', `/financing/vehicles/${fx.vehicleId}/financing`, FINANCING_BODY],
  },
  {
    name: 'PATCH /financing/:id/payment-amount',
    mode: 'owner',
    request: (fx) => [
      'PATCH',
      `/financing/${fx.financingId}/payment-amount`,
      { paymentAmount: 120 },
    ],
  },
  {
    name: 'PUT /financing/:id/payoff',
    mode: 'owner',
    request: (fx) => ['PUT', `/financing/${fx.financingId}/payoff`],
  },
  {
    name: 'DELETE /financing/:id',
    mode: 'owner',
    request: (fx) => ['DELETE', `/financing/${fx.financingId}`],
  },
  {
    name: 'GET /insurance/vehicles/:id/policies',
    mode: 'read',
    request: (fx) => ['GET', `/insurance/vehicles/${fx.vehicleId}/policies`],
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
    request: (fx) => ['GET', `/reminders?vehicleId=${fx.vehicleId}`],
  },
  {
    name: 'POST /reminders',
    mode: 'write',
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
    request: (fx) => ['GET', `/odometer/${fx.vehicleId}`],
  },
  {
    name: 'GET /odometer/:vehicleId/history',
    mode: 'read',
    request: (fx) => ['GET', `/odometer/${fx.vehicleId}/history`],
    returnsOwnerRow: (fx) => fx.odometerId,
  },
  {
    name: 'GET /odometer/entry/:id',
    mode: 'read',
    request: (fx) => ['GET', `/odometer/entry/${fx.odometerId}`],
  },
  {
    name: 'POST /odometer/:vehicleId',
    mode: 'write',
    request: (fx) => [
      'POST',
      `/odometer/${fx.vehicleId}`,
      { odometer: 32000, recordedAt: '2024-07-01T00:00:00.000Z' },
    ],
  },
  {
    name: 'PUT /odometer/:id',
    mode: 'write',
    request: (fx) => ['PUT', `/odometer/${fx.odometerId}`, { odometer: 31500 }],
  },
  {
    name: 'DELETE /odometer/:id',
    mode: 'write',
    request: (fx) => ['DELETE', `/odometer/${fx.odometerId}`],
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
  fx = {
    vehicleId,
    expenseId: expense.data.id,
    odometerId: odometer.data.id,
    financingId: financing.data.id,
    policyId: policy.data.id,
    termId: policy.data.terms[0].id,
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
});
afterEach(() => ctx.close());

describe('every vehicle-scoped route enforces owner / editor / viewer / stranger access', () => {
  for (const route of ROUTES) {
    for (const actor of ['owner', 'editor', 'viewer', 'stranger'] as const) {
      const allowed = ALLOWED[route.mode].includes(actor);
      test(`${route.name} as ${actor} → ${allowed ? 'allowed' : '404'}`, async () => {
        const [method, path, body] = route.request(fx);
        const res = await as[actor](method, `/api/v1${path}`, body);
        if (allowed) {
          const text = await res.text();
          expect(res.status, text).toBeLessThan(300);
          if (route.returnsOwnerRow) expect(text).toContain(route.returnsOwnerRow(fx));
        } else {
          expect(res.status).toBe(404);
        }
      });
    }
  }
});
