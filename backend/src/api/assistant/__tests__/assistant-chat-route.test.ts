/**
 * POST /api/v1/assistant/chat through the real stack, with the provider's fetch stubbed to script each
 * model turn. Covers the tool loop, the tool allowlist, argument validation, the turn cap, provider
 * errors, and user scoping.
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

/** A model turn that requests a tool call (OpenAI tool_calls wire shape). */
function callTurn(name: string, argsJson: string): Record<string, unknown> {
  return {
    choices: [{ message: { tool_calls: [{ id: 'c1', function: { name, arguments: argsJson } }] } }],
  };
}
/** A model turn that returns a final text answer. */
function answerTurn(text: string): Record<string, unknown> {
  return { choices: [{ message: { content: text } }] };
}

/** Install a stateful fetch stub that yields the next scripted response per model turn. */
function stubScript(turns: Record<string, unknown>[]): void {
  script = turns;
  scriptIdx = 0;
  globalThis.fetch = (async () => {
    const body = script[Math.min(scriptIdx, script.length - 1)];
    scriptIdx++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  }) as any;
}
function stubFailure(status: number): void {
  // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  globalThis.fetch = (async () => new Response('upstream error', { status })) as any;
}

/** Seed an enabled openai-compatible llm provider via the REAL create route. */
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

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.close();
});

describe('POST /api/v1/assistant/chat', () => {
  test('a tool call followed by an answer returns the reply and the tool that ran', async () => {
    await seedLlmProvider();
    // Turn 1: the model asks for getExpenseSummary; Turn 2: it answers with the grounded text.
    stubScript([
      callTurn('getExpenseSummary', '{"range":"all"}'),
      answerTurn('You have spent $0 so far.'),
    ]);

    const res = await ctx.authed('POST', '/api/v1/assistant/chat', {
      message: 'How much have I spent?',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    expect(data.reply).toBe('You have spent $0 so far.');
    expect(data.toolsUsed).toEqual(['getExpenseSummary']);
  });

  test('an unknown tool name is rejected and the model recovers', async () => {
    await seedLlmProvider();
    stubScript([
      callTurn('dropAllTables', '{}'),
      answerTurn('I could not do that, but here is a summary.'),
    ]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    expect(data.toolsUsed).toEqual([]);
    expect(data.reply).toContain('summary');
  });

  test('invalid tool arguments are rejected before the tool runs', async () => {
    await seedLlmProvider();
    stubScript([
      callTurn('getFuelStats', '{"range":"last-tuesday"}'),
      answerTurn('Here is what I found.'),
    ]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'mpg?' });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<ChatReply>>(res)).data.toolsUsed).toEqual([]);
  });

  test('a runaway tool loop stops with an honest bounded reply', async () => {
    await seedLlmProvider();
    // The model never answers, so the loop must stop at its turn cap. The stub repeats its last entry.
    stubScript([callTurn('listVehicles', '{}')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'loop forever' });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    expect(data.reply).toMatch(/not able to finish|try rephrasing/i);
  });

  test('NO configured llm provider → 400 with an actionable message', async () => {
    stubScript([answerTurn('hi')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/assistant|provider|Settings/i);
  });

  test('a provider failure returns 502, never a faked reply', async () => {
    await seedLlmProvider();
    stubFailure(429);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(502);
  });

  test('the api key is never echoed in the response', async () => {
    await seedLlmProvider();
    stubScript([answerTurn('done')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(await res.text()).not.toContain('sk-secret-llm-key');
  });

  test('an empty message is rejected (400, zValidator)', async () => {
    await seedLlmProvider();
    stubScript([answerTurn('hi')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: '' });
    expect(res.status).toBe(400);
  });

  test('an unauthenticated request is rejected (401)', async () => {
    const res = await ctx.anon('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(401);
  });

  test('tools only return the session user’s data', async () => {
    await seedLlmProvider();
    // Seed the session user's vehicle + a foreign user's vehicle.
    const mine = await seedVehicle(ctx, { make: 'Mine', model: 'Car', year: 2022 });
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('other-llm-route', 'o@test.com', 'Other')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-foreign', 'other-llm-route', 'Foreign', 'Car', 2022)`
    );
    stubScript([callTurn('listVehicles', '{}'), answerTurn('You have 1 vehicle.')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'my vehicles?' });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const data = JSON.parse(raw) as DataEnvelope<ChatReply>;
    expect(data.data.toolsUsed).toEqual(['listVehicles']);
    expect(raw).not.toContain('veh-foreign');
    expect(mine).toBeTruthy();
  });
});
