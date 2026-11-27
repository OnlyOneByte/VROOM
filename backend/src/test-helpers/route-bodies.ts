import type { Hono } from 'hono';

export interface SweepCall {
  path?: string;
  body?: unknown;
  form?: () => FormData;
  headers?: Record<string, string>;
}

const DATE = '2024-06-01T00:00:00.000Z';

export async function sendSweepCall(
  app: Hono,
  cookie: string,
  method: string,
  path: string,
  call: SweepCall
): Promise<Response> {
  const headers: Record<string, string> = {
    'Sec-Fetch-Site': 'same-origin',
    Cookie: cookie,
    ...call.headers,
  };
  if (call.form) return app.request(path, { method, headers, body: call.form() });
  if (call.body === undefined) return app.request(path, { method, headers });
  headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, body: JSON.stringify(call.body) });
}

function upload(field: string, name: string, type: string, extra: Record<string, string> = {}) {
  return () => {
    const form = new FormData();
    form.set(field, new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type }));
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    return form;
  };
}

export function writeRouteCalls(vehicleId: string, userId: string): Record<string, SweepCall> {
  const even = { method: 'even', vehicleIds: [vehicleId] };
  const coverage = { vehicleIds: [vehicleId] };
  return {
    'PATCH /api/v1/auth/me': { body: { displayName: 'Sweep' } },
    'POST /api/v1/vehicles': { body: { make: 'Kia', model: 'Rio', year: 2020 } },
    'POST /api/v1/vehicles/:vehicleId/photos': { form: upload('photo', 'car.jpg', 'image/jpeg') },
    'PUT /api/v1/vehicles/:vehicleId/drivers/rules': {
      body: { running: { kind: 'distance' }, ownership: { kind: 'payer' } },
    },
    'POST /api/v1/vehicles/:vehicleId/drivers': { body: { name: 'Sweep' } },
    'PATCH /api/v1/vehicles/:vehicleId/drivers/:driverId': { body: { name: 'Sweep' } },
    'POST /api/v1/vehicles/:vehicleId/drivers/backfill/preview': { body: { mode: 'logged' } },
    'POST /api/v1/vehicles/:vehicleId/drivers/backfill': { body: { mode: 'logged' } },
    'PUT /api/v1/vehicles/:vehicleId/car-share': { body: { enabled: true } },
    'POST /api/v1/financing/vehicles/:vehicleId/financing': {
      body: {
        financingType: 'loan',
        provider: 'Sweep Bank',
        originalAmount: 1000,
        termMonths: 12,
        startDate: DATE,
        paymentAmount: 100,
        paymentFrequency: 'monthly',
      },
    },
    'PATCH /api/v1/financing/:financingId/payment-amount': { body: { paymentAmount: 100 } },
    'POST /api/v1/expenses': {
      body: { vehicleId, category: 'maintenance', expenseAmount: 40, date: DATE },
    },
    'POST /api/v1/expenses/import': { body: { csv: 'date,amount\n2024-06-01,40\n' } },
    'POST /api/v1/expenses/import/detect': { body: { sample: 'Date,Odometer,Fill Amount,Price' } },
    'POST /api/v1/expenses/split': {
      body: { splitConfig: even, category: 'maintenance', date: DATE, totalAmount: 30 },
    },
    'PUT /api/v1/expenses/split/:id': { body: { splitConfig: even, totalAmount: 30 } },
    'POST /api/v1/insurance': {
      body: {
        company: 'Sweep Mutual',
        terms: [
          { startDate: DATE, endDate: '2025-06-01T00:00:00.000Z', vehicleCoverage: coverage },
        ],
      },
    },
    'POST /api/v1/insurance/:id/terms': {
      body: { startDate: DATE, endDate: '2025-06-01T00:00:00.000Z', vehicleCoverage: coverage },
    },
    'POST /api/v1/insurance/:id/claims': {
      body: { claimDate: DATE, claimType: 'collision', payoutAmount: 100 },
    },
    'POST /api/v1/odometer/:vehicleId': { body: { odometer: 1000, recordedAt: DATE } },
    'POST /api/v1/photos/:entityType/:entityId': {
      path: `/api/v1/photos/vehicle/${vehicleId}`,
      form: upload('photo', 'car.jpg', 'image/jpeg'),
    },
    'POST /api/v1/providers': {
      body: {
        domain: 'storage',
        providerType: 'google-photos',
        displayName: 'Sweep photos',
        credentials: {},
      },
    },
    'POST /api/v1/receipts/parse': { form: upload('image', 'receipt.jpg', 'image/jpeg') },
    'POST /api/v1/assistant/chat': { body: { message: 'How much did I spend?' } },
    'POST /api/v1/sync': { body: { syncTypes: ['backup'] } },
    'POST /api/v1/sync/restore/from-provider': {
      headers: { 'Idempotency-Key': 'sweep-from-provider' },
      body: {
        sourceType: 'zip',
        providerId: 'sweep-provider',
        fileRef: 'backup.zip',
        mode: 'preview',
      },
    },
    'POST /api/v1/sync/restore/from-backup': {
      headers: { 'Idempotency-Key': 'sweep-from-backup' },
      form: upload('file', 'backup.zip', 'application/zip', { mode: 'preview' }),
    },
    'POST /api/v1/reminders': {
      body: {
        name: 'Sweep',
        type: 'notification',
        frequency: 'monthly',
        startDate: DATE,
        vehicleIds: [vehicleId],
      },
    },
    'POST /api/v1/trips': {
      body: {
        vehicleId,
        startOdometer: 1000,
        endOdometer: 1100,
        purpose: 'business',
        tripDate: DATE,
      },
    },
    'POST /api/v1/shares': { body: { vehicleId, email: 'sweep@x.test', level: 'viewer' } },
    'PUT /api/v1/shares/:id': { body: { level: 'viewer' } },
    'POST /api/v1/roles': { body: { scope: 'vehicle', name: 'Sweep' } },
    'PATCH /api/v1/roles/:id': { body: { name: 'Sweep' } },
    'PUT /api/v1/roles/:id/permissions': { body: { permissions: [] } },
    'POST /api/v1/role-assignments': { body: { userId: 'sweep-nobody', roleId: 'builtin_member' } },
    'PUT /api/v1/overrides': {
      body: {
        userId,
        scope: 'vehicle',
        scopeId: vehicleId,
        permission: 'vehicle.read',
        effect: 'allow',
      },
    },
    'POST /api/v1/push/subscribe': {
      body: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/sweep',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
    },
    'POST /api/v1/calendar/feed': { body: {} },
    'PUT /api/v1/calendar/feed': { body: { options: {} } },
  };
}
