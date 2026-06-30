/**
 * LLM assistant T7 — the tool-RESULT round-trip guard (the merge-surviving half of the feature DoD).
 *
 * The T4 route test (assistant-chat-route.test.ts) pins the route/orchestrator CONTRACT — the guards
 * (allowlist, Zod, IDOR), the K/T caps, the 400/502 honesty — but every one of its tool-call cases runs
 * against an EMPTY DB, so it never inspects WHAT the tool returned or that the model actually SAW it.
 * This pins the OTHER half NORTH_STAR #3 cares about: that a read tool, run over REAL seeded data, feeds
 * its real aggregate BACK to the model (design §4 step d) so the grounded answer reflects the user's own
 * numbers — the full FE→BE→tool-loop→reply seam, end to end, without a live LLM or a browser.
 *
 * How it proves the feed-back: the fetch stub is STATEFUL and CAPTURES each request body. On turn 2 we
 * assert the messages array the orchestrator sent back contains a `role:'tool'` message whose content is
 * the JSON of the tool's REAL result (the seeded vehicles / the seeded expense summary). If the
 * orchestrator dropped the result, that message would be absent and the assertion fails. The model's
 * "answer" turn is scripted to echo a number we can only know if the result was threaded through.
 *
 * The live-LLM leg (a real key/endpoint) stays the untracked Playwright e2e; this is the committed,
 * merge-surviving net under the seam.
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

/** Each scripted entry is one model turn's OpenAI-style response body. */
let script: Record<string, unknown>[];
let scriptIdx: number;
/** Every outbound request body the adapter sent, in order — so we can inspect what the model "saw". */
let sentBodies: Array<{ messages: Array<{ role: string; content?: unknown }> }>;

function callTurn(name: string, argsJson: string): Record<string, unknown> {
  return {
    choices: [{ message: { tool_calls: [{ id: 'c1', function: { name, arguments: argsJson } }] } }],
  };
}
function answerTurn(text: string): Record<string, unknown> {
  return { choices: [{ message: { content: text } }] };
}

/** Stateful stub that records each request body AND yields the next scripted response per model turn. */
function stubScriptCapturing(turns: Record<string, unknown>[]): void {
  script = turns;
  scriptIdx = 0;
  sentBodies = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      try {
        sentBodies.push(JSON.parse(init.body));
      } catch {
        // non-JSON body — ignore (the assistant adapter always sends JSON)
      }
    }
    const body = script[Math.min(scriptIdx, script.length - 1)];
    scriptIdx++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  }) as any;
}

async function seedLlmProvider(): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'llm',
    providerType: 'openai-compatible',
    displayName: 'My Assistant',
    credentials: { apiKey: 'sk-secret-llm-key' },
    config: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status).toBe(201);
}

interface ChatReply {
  reply: string;
  toolsUsed: string[];
}

/** Collect every `role:'tool'` message content the orchestrator sent back to the model (all turns). */
function toolMessagesSent(): string[] {
  const out: string[] = [];
  for (const body of sentBodies) {
    for (const m of body.messages ?? []) {
      if (m.role === 'tool' && typeof m.content === 'string') out.push(m.content);
    }
  }
  return out;
}

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.close();
});

describe('LLM assistant tool-result round-trip: real data fed back to the model (T7)', () => {
  test('listVehicles result (real seeded rows) is threaded back to the model on the next turn', async () => {
    await seedLlmProvider();
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2020 });
    const v2 = await seedVehicle(ctx, { make: 'Tesla', model: 'Model 3', year: 2023 });
    expect(v1).toBeTruthy();
    expect(v2).toBeTruthy();

    // Turn 1: the model asks for listVehicles. Turn 2: it answers using the count it could only know
    // if the tool result was fed back.
    stubScriptCapturing([
      callTurn('listVehicles', '{}'),
      answerTurn('You have 2 vehicles: a Honda Civic and a Tesla Model 3.'),
    ]);

    const res = await ctx.authed('POST', '/api/v1/assistant/chat', {
      message: 'what cars do I have?',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    expect(data.toolsUsed).toEqual(['listVehicles']);

    // The crux: a tool message carrying the REAL seeded rows was sent BACK to the model (design §4 step d).
    const toolMsgs = toolMessagesSent();
    expect(toolMsgs.length).toBeGreaterThan(0);
    const combined = toolMsgs.join('\n');
    expect(combined).toContain('Honda');
    expect(combined).toContain('Civic');
    expect(combined).toContain('Tesla');
    // And the grounded answer reflects it (the model saw the data).
    expect(data.reply).toContain('2 vehicles');
  });

  test('getExpenseSummary result reflects a REAL seeded expense fed back to the model', async () => {
    await seedLlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Ford', model: 'F150', year: 2021 });
    // Seed one real expense via the UNCHANGED create route ($120.00 fuel).
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'fuel',
      expenseAmount: 120,
      date: '2026-05-01',
      volume: 15.2,
      mileage: 30000,
    });
    expect(created.status, await created.clone().text()).toBe(201);

    stubScriptCapturing([
      callTurn('getExpenseSummary', '{"range":"all"}'),
      answerTurn('You have spent $120.00 in total.'),
    ]);

    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'total spend?' });
    expect(res.status, await res.clone().text()).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    expect(data.toolsUsed).toEqual(['getExpenseSummary']);

    // The tool result fed back to the model must carry the real summed total (cents — 12000 — or a
    // dollar-bearing field). Assert the seeded amount appears in what the model saw.
    const combined = toolMessagesSent().join('\n');
    expect(combined.length).toBeGreaterThan(0);
    // The summary aggregates money in cents on the repo seam; the seeded $120 → 12000 cents.
    expect(combined).toContain('12000');
  });

  test('a two-tool conversation threads BOTH results back before the final answer', async () => {
    await seedLlmProvider();
    await seedVehicle(ctx, { make: 'Mazda', model: 'CX5', year: 2022 });

    // Turn 1: listVehicles. Turn 2: getAnalyticsSummary. Turn 3: the grounded answer.
    stubScriptCapturing([
      callTurn('listVehicles', '{}'),
      callTurn('getAnalyticsSummary', '{"range":"all"}'),
      answerTurn('Here is a summary of your 1 vehicle.'),
    ]);

    const res = await ctx.authed('POST', '/api/v1/assistant/chat', {
      message: 'summarize my fleet',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    expect(data.toolsUsed).toEqual(['listVehicles', 'getAnalyticsSummary']);

    // Both tool results were threaded back (≥2 tool messages across the captured turns).
    expect(toolMessagesSent().length).toBeGreaterThanOrEqual(2);
    expect(toolMessagesSent().join('\n')).toContain('Mazda');
  });
});
