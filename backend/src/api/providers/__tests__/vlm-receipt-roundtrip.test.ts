/**
 * VLM receipt-parsing T7 — the DRAFT → CREATE round-trip guard (the merge-surviving half of the
 * feature DoD). The T4 test (vlm-parse-route.test.ts) pins that `POST /receipts/parse` returns a clean
 * draft and PERSISTS NOTHING; this pins the OTHER half NORTH_STAR #3 cares about: that the returned
 * draft, mapped exactly as the expense form maps it, drives a SUCCESSFUL `POST /expenses` create whose
 * money + fields survive end-to-end. The two together prove the whole FE→BE→draft→form→create seam
 * without a live VLM or a browser (the live-VLM + photo-attach leg is the untracked Playwright e2e,
 * which needs the dev server's ALLOW_FAKE_STORAGE seam — gated off in the in-process suite, C91).
 *
 * "Mapped exactly as the form maps it" = ExpenseForm.handleReceiptDraft + handleSubmit + toBackendExpense:
 *   draft.amount   (dollars)        → expenseAmount  (dollars in the body; POST transforms → cents)
 *   draft.date     ("YYYY-MM-DD")   → date           (the form's dateOnlyToISO → noon-local ISO)
 *   draft.odometer (integer)        → mileage
 *   draft.vendor   (string)         → description     (only when the description is empty)
 *   draft.category (one of 6)       → category
 * The GET back returns expenseToApi (cents→dollars), so a $47.83 draft must read back as 47.83 — the
 * money-cents boundary is the exact thing a draft round-trip could silently corrupt.
 *
 * The adapter's outbound fetch is STUBBED (the mocked VLM provider) — no live key/endpoint. Multipart
 * can't go through ctx.authed (JSON-only), so the parse request is built directly via ctx.app with the
 * real session cookie + Sec-Fetch-Site (the csrf-middleware contract for a non-JSON POST), mirroring T4.
 */

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

/** Stub the adapter's outbound fetch to return one OpenAI-style chat completion with `content`. */
function stubModel(content: string): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
    })) as any;
}

/** Seed an enabled openai-compatible vlm provider via the REAL create route. */
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

/** POST a multipart receipt image to /receipts/parse → return the parsed draft. */
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

/**
 * Map a draft to a create body EXACTLY as the expense form does (handleReceiptDraft → handleSubmit →
 * toBackendExpense), then POST it. `existingDescription` models the form's "fill description only when
 * empty" rule. Money goes in as DOLLARS — the route transforms to cents. Returns the created row id.
 */
async function confirmDraftAsExpense(
  draft: Draft,
  vehicleId: string,
  existingDescription = ''
): Promise<string> {
  // vendor → description ONLY when the user has not already typed one (the form's guard).
  const description =
    draft.vendor && !existingDescription.trim() ? draft.vendor : existingDescription || undefined;

  const body: Record<string, unknown> = {
    vehicleId,
    category: draft.category,
    // draft.amount is dollars; the form sends parseFloat(formData.amount) as dollars → POST → cents.
    expenseAmount: draft.amount,
    // The form's date field is pre-seeded to today (toDateInputValue) and runs dateOnlyToISO on submit,
    // so a draft that omits the date still submits the form's default — never an empty date. Mirror that
    // with a fixed default so the body always carries a date (the create schema requires one).
    date: draft.date ?? '2026-06-30',
    // odometer → mileage (only fuel rows keep it, but the create schema accepts it on any category;
    // here the draft category is fuel so it is retained, matching the form's selectCategory behavior).
    ...(typeof draft.odometer === 'number' ? { mileage: draft.odometer } : {}),
    ...(description ? { description } : {}),
    // A fuel expense needs a volume to satisfy the fuel refinement; the user supplies it on confirm.
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

describe('VLM receipt-parsing round-trip: parse → draft → confirm via POST /expenses (T7)', () => {
  test('a full draft confirms into a persisted expense with money + every field intact', async () => {
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Shell', model: 'Receipt', year: 2024 });
    // The marquee draft from the T6 eyes-on: a fuel receipt with a $47.83 total + an odometer reading.
    stubModel(
      '{"amount": 47.83, "date": "2026-03-12", "odometer": 84231, "category": "fuel", "vendor": "Shell Station"}'
    );

    // 1) Parse — the route returns the validated draft and persists NOTHING.
    const before = expenseCount();
    const draft = await parseReceipt();
    expect(draft).toEqual({
      amount: 47.83,
      date: '2026-03-12',
      odometer: 84231,
      category: 'fuel',
      vendor: 'Shell Station',
    });
    expect(expenseCount()).toBe(before); // parse persisted nothing (the T4 invariant, re-asserted here)

    // 2) Confirm — the form maps the draft into the UNCHANGED create path.
    const id = await confirmDraftAsExpense(draft, vehicleId);
    expect(expenseCount()).toBe(before + 1);

    // 3) Read it back through the API (cents→dollars) — the seam preserved every drafted field.
    const row = await getExpense(id);
    expect(row.vehicleId).toBe(vehicleId);
    expect(row.category).toBe('fuel');
    expect(row.expenseAmount).toBe(47.83); // the dollars→cents→dollars money boundary survived exactly
    expect(row.mileage).toBe(84231); // odometer → mileage
    expect(row.description).toBe('Shell Station'); // vendor → description (was empty)
    // date round-trips to the same calendar day (stored noon-local-ish; assert the Y-M-D prefix).
    expect(row.date.slice(0, 10)).toBe('2026-03-12');
  });

  test('a partial draft (amount only) confirms — the user fills the rest, money still exact', async () => {
    await seedVlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Misc', model: 'Co', year: 2024 });
    // The model read only a total; everything else is dropped/omitted (fail-closed). The user picks a
    // category by hand on confirm — model the simplest non-fuel path so no fuel fields are required.
    stubModel('{"amount": 12.09}');

    const draft = await parseReceipt();
    expect(draft).toEqual({ amount: 12.09 });

    // User supplies the category the draft lacked; vendor absent → no description.
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
    // The form's rule: a vendor fills description ONLY when it is empty. Here the user pre-typed one.
    const id = await confirmDraftAsExpense(draft, vehicleId, 'My own note');
    const row = await getExpense(id);
    expect(row.description).toBe('My own note'); // user's text wins; vendor did not overwrite it
    expect(row.expenseAmount).toBe(5);
  });
});
