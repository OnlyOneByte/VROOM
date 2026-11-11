/**
 * Tool results are fed back to the model. Read tools run over seeded data, and the captured request
 * bodies must contain each real result. The scripted answer can only mention a figure if the result
 * was threaded through. Covers the seam without a live LLM.
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

describe('assistant tool results are fed back to the model', () => {
  test('listVehicles result (real seeded rows) is sent back to the model on the next turn', async () => {
    await seedLlmProvider();
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2020 });
    const v2 = await seedVehicle(ctx, { make: 'Tesla', model: 'Model 3', year: 2023 });
    expect(v1).toBeTruthy();
    expect(v2).toBeTruthy();

    // The answer can only mention two vehicles if the tool result was sent back.
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

    const toolMsgs = toolMessagesSent();
    expect(toolMsgs.length).toBeGreaterThan(0);
    const combined = toolMsgs.join('\n');
    expect(combined).toContain('Honda');
    expect(combined).toContain('Civic');
    expect(combined).toContain('Tesla');
    expect(data.reply).toContain('2 vehicles');
  });

  test('getExpenseSummary result reflects a REAL seeded expense fed back to the model', async () => {
    await seedLlmProvider();
    const vehicleId = await seedVehicle(ctx, { make: 'Ford', model: 'F150', year: 2021 });
    // Seeds a $120 fuel expense through the create route.
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

    // Summed cents are converted to dollars before reaching the model; a raw 12000 would read as $12,000.
    const combined = toolMessagesSent().join('\n');
    expect(combined.length).toBeGreaterThan(0);
    expect(combined).toContain('"totalAmount":120');
    expect(combined).not.toContain('12000');
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

    expect(toolMessagesSent().length).toBeGreaterThanOrEqual(2);
    expect(toolMessagesSent().join('\n')).toContain('Mazda');
  });
});
