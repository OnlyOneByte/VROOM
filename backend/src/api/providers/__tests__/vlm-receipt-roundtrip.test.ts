import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.close();
});

function stubModel(content: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
    })) as any;
}

async function seedVlmProvider(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'vlm',
    providerType: 'openai-compatible',
    displayName: 'My VLM',
    credentials: { apiKey: 'sk-secret-key' },
    config: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status).toBe(201);
}

interface Draft {
  amount?: number;
  date?: string;
  odometer?: number;
  category?: string;
  vendor?: string;
}

async function parseReceipt(): Promise<Draft> {
  const form = new FormData();
  form.append('image', new Blob([Buffer.from('fake-jpeg-bytes')], { type: 'image/jpeg' }), 'r.jpg');
  const res = await ctx.app.request('/api/v1/receipts/parse', {
    method: 'POST',
    headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'same-origin' },
    body: form,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await json<DataEnvelope<{ draft: Draft }>>(res)).data.draft;
}

async function confirmDraftAsExpense(
  draft: Draft,
  vehicleId: string,
  existingDescription = ''
): Promise<string> {
  const description =
    draft.vendor && !existingDescription.trim() ? draft.vendor : existingDescription || undefined;

  const body: Record<string, unknown> = {
    vehicleId,
    category: draft.category,
    expenseAmount: draft.amount,
    date: draft.date ?? '2026-06-30',
    ...(typeof draft.odometer === 'number' ? { mileage: draft.odometer } : {}),
    ...(description ? { description } : {}),
    ...(draft.category === 'fuel' ? { volume: 12.4 } : {}),
  };

  const res = await ctx.authed('POST', '/api/v1/expenses', body);
  const parsed = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(parsed)).toBe(201);
  return parsed.data.id;
}

interface ExpenseApiRow {
  id: string;
  vehicleId: string;
  category: string;
  expenseAmount: number;
  mileage: number | null;
  description: string | null;
  date: string;
}

async function getExpense(id: string): Promise<ExpenseApiRow> {
  const res = await ctx.authed('GET', `/api/v1/expenses/${id}`);
  expect(res.status).toBe(200);
  return (await json<DataEnvelope<ExpenseApiRow>>(res)).data;
}

function expenseCount(): number {
  return (ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number }).n;
}

describe('VLM receipt-parsing round-trip: parse, draft, then confirm via POST /expenses', () => {
  test('a full draft confirms into a persisted expense with money + every field intact', async () => {
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Shell', model: 'Receipt', year: 2024 });
    stubModel(
      '{"amount": 47.83, "date": "2026-03-12", "odometer": 84231, "category": "fuel", "vendor": "Shell Station"}'
    );

    const before = expenseCount();
    const draft = await parseReceipt();
    expect(draft).toEqual({
      amount: 47.83,
      date: '2026-03-12',
      odometer: 84231,
      category: 'fuel',
      vendor: 'Shell Station',
    });
    expect(expenseCount()).toBe(before);

    const id = await confirmDraftAsExpense(draft, vehicleId);
    expect(expenseCount()).toBe(before + 1);

    const row = await getExpense(id);
    expect(row.vehicleId).toBe(vehicleId);
    expect(row.category).toBe('fuel');
    expect(row.expenseAmount).toBe(47.83);
    expect(row.mileage).toBe(84231);
    expect(row.description).toBe('Shell Station');
    expect(row.date.slice(0, 10)).toBe('2026-03-12');
  });

  test('a partial draft (amount only) confirms — the user fills the rest, money still exact', async () => {
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Misc', model: 'Co', year: 2024 });
    stubModel('{"amount": 12.09}');

    const draft = await parseReceipt();
    expect(draft).toEqual({ amount: 12.09 });

    const id = await confirmDraftAsExpense({ ...draft, category: 'misc' }, vehicleId);
    const row = await getExpense(id);
    expect(row.category).toBe('misc');
    expect(row.expenseAmount).toBe(12.09);
    expect(row.mileage).toBeNull();
    expect(row.description).toBeNull();
  });

  test('vendor does NOT clobber a description the user already typed', async () => {
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Misc', model: 'Co', year: 2024 });
    stubModel('{"amount": 5, "category": "misc", "vendor": "Quick Wash"}');

    const draft = await parseReceipt();
    const id = await confirmDraftAsExpense(draft, vehicleId, 'My own note');
    const row = await getExpense(id);
    expect(row.description).toBe('My own note');
    expect(row.expenseAmount).toBe(5);
  });
});
