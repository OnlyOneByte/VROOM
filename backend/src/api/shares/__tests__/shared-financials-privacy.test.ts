import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee, type Invitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let editor: Invitee;
let viewer: Invitee;
let stranger: Invitee;

const RANGE = 'startDate=1704067200&endDate=1735689600';
const VIN = '1HGCM82633A004352';
const LOAN_CLIENT_ID = 'owner-loan-payment-1';

interface Garage {
  vehicleId: string;
  financingId: string;
  loanPaymentId: string;
  premiumGroupId: string;
  maintenanceId: string;
}

beforeEach(async () => {
  ctx = await createTestApp();
  editor = await createInvitee(ctx, 'fin-editor');
  viewer = await createInvitee(ctx, 'fin-viewer');
  stranger = await createInvitee(ctx, 'fin-stranger');
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function created<T>(res: Response): Promise<T> {
  const body = await json<DataEnvelope<T>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data;
}

async function sharedGarage(): Promise<Garage> {
  const vehicleId = await seedVehicle(ctx, {
    make: 'Honda',
    model: 'Civic',
    year: 2021,
    extra: { vin: VIN, purchasePrice: 25000, purchaseDate: '2024-01-01T00:00:00.000Z' },
  });
  const financing = await created<{ id: string }>(
    await ctx.authed('POST', `/api/v1/financing/vehicles/${vehicleId}/financing`, {
      financingType: 'loan',
      provider: 'Private Lender',
      originalAmount: 20000,
      termMonths: 60,
      startDate: '2024-01-01T00:00:00.000Z',
      paymentAmount: 400,
      apr: 5,
    })
  );
  const loanPayment = await created<{ id: string }>(
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'financial',
      expenseAmount: 400,
      date: '2024-02-01T00:00:00.000Z',
      mileage: 12000,
      clientId: LOAN_CLIENT_ID,
      sourceType: 'financing',
      sourceId: financing.id,
    })
  );
  await created(
    await ctx.authed('POST', '/api/v1/insurance', {
      company: 'Private Mutual',
      terms: [
        {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2025-01-01T00:00:00.000Z',
          totalCost: 1200,
          vehicleCoverage: { vehicleIds: [vehicleId] },
        },
      ],
    })
  );
  const maintenance = await created<{ id: string }>(
    await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 80,
      date: '2024-03-01T00:00:00.000Z',
    })
  );
  const premium = (await ctx.sql.get(
    "SELECT group_id FROM expenses WHERE source_type = 'insurance_term'"
  )) as { group_id: string };
  await editor.acceptShare(vehicleId, 'editor');
  await viewer.acceptShare(vehicleId, 'viewer');
  return {
    vehicleId,
    financingId: financing.id,
    loanPaymentId: loanPayment.id,
    premiumGroupId: premium.group_id,
    maintenanceId: maintenance.id,
  };
}

function sharees(): [string, RequestFn][] {
  return [
    ['editor', editor.request],
    ['viewer', viewer.request],
  ];
}

interface VehicleView {
  id: string;
  userId?: string;
  vin?: string | null;
  purchasePrice?: number | null;
  financing?: unknown;
}

function expectRedacted(who: string, vehicle: VehicleView | undefined): void {
  expect(vehicle, who).toBeDefined();
  expect(vehicle?.financing, `${who} financing`).toBeUndefined();
  expect(vehicle?.userId, `${who} owner id`).toBeUndefined();
  expect(vehicle?.vin ?? null, `${who} vin`).toBeNull();
  expect(vehicle?.purchasePrice ?? null, `${who} purchase price`).toBeNull();
}

function amountsOf(rows: Array<{ expenseAmount: number }>): number[] {
  return rows.map((r) => r.expenseAmount).sort((a, b) => a - b);
}

describe('shared vehicle details', () => {
  test('GET /vehicles/:id hides loan, purchase price, VIN and owner id from sharees', async () => {
    const { vehicleId } = await sharedGarage();

    const own = await created<VehicleView>(
      await ctx.authed('GET', `/api/v1/vehicles/${vehicleId}`)
    );
    expect(own.financing).toBeDefined();
    expect(own.vin).toBe(VIN);
    expect(own.purchasePrice).toBe(25000);
    expect(own.userId).toBe(ctx.user.id);

    for (const [who, request] of sharees()) {
      const res = await request('GET', `/api/v1/vehicles/${vehicleId}`);
      const text = await res.text();
      expect(res.status, who).toBe(200);
      expect(text, `${who} raw body`).not.toContain('Private Lender');
      expectRedacted(who, (JSON.parse(text) as DataEnvelope<VehicleView>).data);
    }

    expect((await stranger.request('GET', `/api/v1/vehicles/${vehicleId}`)).status).toBe(404);
  });

  test('GET /vehicles?include=shared hides the same fields on shared rows', async () => {
    const { vehicleId } = await sharedGarage();

    const own = await created<VehicleView[]>(await ctx.authed('GET', '/api/v1/vehicles'));
    expect(own.find((v) => v.id === vehicleId)?.financing).toBeDefined();

    for (const [who, request] of sharees()) {
      const rows = await created<VehicleView[]>(
        await request('GET', '/api/v1/vehicles?include=shared')
      );
      expectRedacted(
        who,
        rows.find((v) => v.id === vehicleId)
      );
    }

    const strangerRows = await created<VehicleView[]>(
      await stranger.request('GET', '/api/v1/vehicles?include=shared')
    );
    expect(strangerRows.find((v) => v.id === vehicleId)).toBeUndefined();
  });
});

describe('shared expense reads', () => {
  test('lists, totals and exports leave out loan payments and premiums for sharees', async () => {
    const { vehicleId } = await sharedGarage();
    const list = `/api/v1/expenses?vehicleId=${vehicleId}`;

    const own = await created<Array<{ expenseAmount: number }>>(await ctx.authed('GET', list));
    expect(amountsOf(own)).toEqual([80, 400, 1200]);

    for (const [who, request] of sharees()) {
      const rows = await created<Array<{ expenseAmount: number }>>(await request('GET', list));
      expect(amountsOf(rows), `${who} list`).toEqual([80]);

      const summary = await created<{ totalAmount: number; categoryBreakdown: unknown[] }>(
        await request('GET', `/api/v1/expenses/summary?vehicleId=${vehicleId}`)
      );
      expect(summary.totalAmount, `${who} summary`).toBe(80);
      expect(summary.categoryBreakdown, `${who} categories`).toEqual([
        { category: 'maintenance', amount: 80, count: 1 },
      ]);

      const months = await created<Array<{ amount: number }>>(
        await request('GET', `/api/v1/expenses/monthly-totals?vehicleId=${vehicleId}`)
      );
      expect(
        months.reduce((sum, m) => sum + m.amount, 0),
        `${who} monthly totals`
      ).toBe(80);

      const csv = await (
        await request('GET', `/api/v1/expenses/export?vehicleId=${vehicleId}`)
      ).text();
      expect(csv, `${who} export`).not.toContain('financial');
    }

    expect((await stranger.request('GET', list)).status).toBe(404);
  });

  test('a loan payment or premium can be read by id only by the owner', async () => {
    const { loanPaymentId, premiumGroupId, maintenanceId } = await sharedGarage();

    expect((await ctx.authed('GET', `/api/v1/expenses/${loanPaymentId}`)).status).toBe(200);
    expect((await ctx.authed('GET', `/api/v1/expenses/split/${premiumGroupId}`)).status).toBe(200);

    for (const [who, request] of sharees()) {
      expect((await request('GET', `/api/v1/expenses/${loanPaymentId}`)).status, who).toBe(404);
      expect((await request('GET', `/api/v1/expenses/split/${premiumGroupId}`)).status, who).toBe(
        404
      );
      expect((await request('GET', `/api/v1/expenses/${maintenanceId}`)).status, who).toBe(200);
    }

    expect((await stranger.request('GET', `/api/v1/expenses/${loanPaymentId}`)).status).toBe(404);
  });
});

describe('shared analytics and insurance', () => {
  test('vehicle TCO and expense charts leave out purchase price, interest and premiums for sharees', async () => {
    const { vehicleId } = await sharedGarage();
    const tco = `/api/v1/analytics/vehicle-tco?vehicleId=${vehicleId}`;
    const charts = `/api/v1/analytics/vehicle-expenses?${RANGE}&vehicleId=${vehicleId}`;

    interface Tco {
      purchasePrice: number | null;
      financingInterest: number;
      insuranceCost: number;
    }
    const own = await created<Tco>(await ctx.authed('GET', tco));
    expect(own.purchasePrice).toBe(25000);
    expect(own.insuranceCost).toBe(1200);

    for (const [who, request] of sharees()) {
      const view = await created<Tco>(await request('GET', tco));
      expect(view.purchasePrice, `${who} purchase price`).toBeNull();
      expect(view.financingInterest, `${who} interest`).toBe(0);
      expect(view.insuranceCost, `${who} premiums`).toBe(0);

      const chart = await created<{ expenseBreakdown: Array<{ category: string }> }>(
        await request('GET', charts)
      );
      expect(
        chart.expenseBreakdown.map((b) => b.category),
        `${who} breakdown`
      ).toEqual(['maintenance']);
    }

    expect((await stranger.request('GET', tco)).status).toBe(404);
  });

  test('a sharee sees the policy but not the premium amounts', async () => {
    const { vehicleId } = await sharedGarage();
    const route = `/api/v1/insurance/vehicles/${vehicleId}/policies`;
    interface Policy {
      terms: Array<{ totalCost: number | null; monthlyCost: number | null }>;
    }

    const own = await created<Policy[]>(await ctx.authed('GET', route));
    expect(own[0]?.terms[0]?.totalCost).toBe(1200);

    for (const [who, request] of sharees()) {
      const policies = await created<Policy[]>(await request('GET', route));
      expect(policies.length, who).toBe(1);
      expect(policies[0]?.terms[0]?.totalCost ?? null, `${who} total`).toBeNull();
      expect(policies[0]?.terms[0]?.monthlyCost ?? null, `${who} monthly`).toBeNull();
    }

    expect((await stranger.request('GET', route)).status).toBe(404);
  });
});

describe('shared expense writes linked to a loan or policy', () => {
  async function storedAmount(id: string): Promise<number | undefined> {
    return (
      (await ctx.sql.get('SELECT expense_amount FROM expenses WHERE id = ?', [id])) as {
        expense_amount: number;
      } | null
    )?.expense_amount;
  }

  function expectRefused(status: number, who: string, action: string): void {
    expect(who === 'stranger' ? [404] : [403, 404], `${who} ${action}`).toContain(status);
  }

  test('only the owner can record, change or delete a loan payment', async () => {
    const { vehicleId, financingId, loanPaymentId } = await sharedGarage();
    const payment = {
      vehicleId,
      category: 'financial',
      expenseAmount: 400,
      date: '2024-03-01T00:00:00.000Z',
      sourceType: 'financing',
      sourceId: financingId,
    };

    for (const [who, request] of [...sharees(), ['stranger', stranger.request] as const]) {
      expectRefused((await request('POST', '/api/v1/expenses', payment)).status, who, 'create');
      expectRefused(
        (await request('PUT', `/api/v1/expenses/${loanPaymentId}`, { expenseAmount: 1 })).status,
        who,
        'update'
      );
      expectRefused(
        (
          await request('PUT', `/api/v1/expenses/${loanPaymentId}`, {
            sourceType: null,
            sourceId: null,
          })
        ).status,
        who,
        'unlink'
      );
      expectRefused(
        (await request('DELETE', `/api/v1/expenses/${loanPaymentId}`)).status,
        who,
        'delete'
      );
    }
    const linked = (await ctx.sql.get(
      "SELECT COUNT(*) AS n FROM expenses WHERE source_type = 'financing'"
    )) as { n: number };
    expect(linked.n).toBe(1);
    expect(await storedAmount(loanPaymentId)).toBe(40000);

    expect((await ctx.authed('POST', '/api/v1/expenses', payment)).status).toBe(201);
    expect(
      (await ctx.authed('PUT', `/api/v1/expenses/${loanPaymentId}`, { expenseAmount: 410 })).status
    ).toBe(200);
    expect((await ctx.authed('DELETE', `/api/v1/expenses/${loanPaymentId}`)).status).toBe(200);
  });

  test('an editor cannot link an existing expense to the loan', async () => {
    const { financingId, maintenanceId } = await sharedGarage();

    const res = await editor.request('PUT', `/api/v1/expenses/${maintenanceId}`, {
      category: 'financial',
      sourceType: 'financing',
      sourceId: financingId,
    });
    expect(res.status).toBe(404);
    const row = (await ctx.sql.get('SELECT source_type FROM expenses WHERE id = ?', [
      maintenanceId,
    ])) as { source_type: string | null };
    expect(row.source_type).toBeNull();
  });

  test('only the owner can delete an insurance premium', async () => {
    const { premiumGroupId } = await sharedGarage();
    const premiumRows = async () =>
      (
        (await ctx.sql.get('SELECT COUNT(*) AS n FROM expenses WHERE group_id = ?', [
          premiumGroupId,
        ])) as { n: number }
      ).n;

    for (const [who, request] of [...sharees(), ['stranger', stranger.request] as const]) {
      expectRefused(
        (await request('DELETE', `/api/v1/expenses/split/${premiumGroupId}`)).status,
        who,
        'delete'
      );
    }
    expect(await premiumRows()).toBe(1);

    expect((await ctx.authed('DELETE', `/api/v1/expenses/split/${premiumGroupId}`)).status).toBe(
      200
    );
    expect(await premiumRows()).toBe(0);
  });
});

describe('other views of a loan payment', () => {
  test('odometer history leaves out readings from loan payments for sharees', async () => {
    const { vehicleId, loanPaymentId } = await sharedGarage();
    const route = `/api/v1/odometer/${vehicleId}/history`;

    const own = await created<Array<{ sourceId: string }>>(await ctx.authed('GET', route));
    expect(own.map((r) => r.sourceId)).toContain(loanPaymentId);

    for (const [who, request] of sharees()) {
      const rows = await created<Array<{ sourceId: string }>>(await request('GET', route));
      expect(
        rows.map((r) => r.sourceId),
        `${who} history`
      ).not.toContain(loanPaymentId);
    }

    expect((await stranger.request('GET', route)).status).toBe(404);
  });

  test('photos on a loan payment are owner-only', async () => {
    const { loanPaymentId, maintenanceId } = await sharedGarage();

    expect((await ctx.authed('GET', `/api/v1/photos/expense/${loanPaymentId}`)).status).toBe(200);
    for (const [who, request] of [...sharees(), ['stranger', stranger.request] as const]) {
      expect(
        (await request('GET', `/api/v1/photos/expense/${loanPaymentId}`)).status,
        `${who} list`
      ).toBe(404);
    }
    expect((await editor.request('GET', `/api/v1/photos/expense/${maintenanceId}`)).status).toBe(
      200
    );
  });

  test("an editor replaying the owner's loan payment request gets nothing back", async () => {
    const { vehicleId, financingId } = await sharedGarage();

    const res = await editor.request('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 1,
      date: '2024-02-01T00:00:00.000Z',
      clientId: LOAN_CLIENT_ID,
    });
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(text).not.toContain(financingId);
  });
});
