import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CONFIG } from '../config';
import { createTestApp, requestAs, type TestApp } from '../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function statusesFor(
  count: number,
  send: () => Response | Promise<Response>
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await send()).status);
  return statuses;
}

async function anotherUser(): Promise<ReturnType<typeof requestAs>> {
  const id = `limits-other-${crypto.randomUUID()}`;
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    id,
    `${id}@example.com`,
    'Other',
  ]);
  return requestAs(ctx, id);
}

function receiptForm(): FormData {
  const form = new FormData();
  form.append('image', new File([new Uint8Array([1, 2, 3])], 'r.gif', { type: 'image/gif' }));
  return form;
}

describe('per-user limits on expensive routes', () => {
  test('the assistant refuses one message over the limit, and only for that user', async () => {
    const { limit } = CONFIG.rateLimit.assistant;
    const send = () => ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    const statuses = await statusesFor(limit + 1, send);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const other = await anotherUser();
    expect(
      (await other.request('POST', '/api/v1/assistant/chat', { message: 'hi' })).status
    ).not.toBe(429);
  });

  test('receipt scans are limited per user', async () => {
    const { limit } = CONFIG.rateLimit.receiptScan;
    const send = () =>
      ctx.app.request('/api/v1/receipts/parse', {
        method: 'POST',
        headers: { Cookie: ctx.cookie, Origin: 'http://localhost:3000' },
        body: receiptForm(),
      });
    const statuses = await statusesFor(limit + 1, send);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test('CSV imports are limited per user', async () => {
    const { limit } = CONFIG.rateLimit.expenseImport;
    const send = () =>
      ctx.authed('POST', '/api/v1/expenses/import', { csv: 'date,amount\n', dryRun: true });
    const statuses = await statusesFor(limit + 1, send);
    expect(statuses.slice(0, -1).every((s) => s !== 429)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
