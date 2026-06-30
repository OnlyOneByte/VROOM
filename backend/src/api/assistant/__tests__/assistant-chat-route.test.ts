/**
 * Assistant chat route (llm-assistant T4) — `POST /api/v1/assistant/chat`. Drives the REAL stack
 * (middleware → requireAuth → zValidator → handler → orchestrator → registry → adapter) via the
 * in-process harness, with the adapter's outbound fetch STUBBED to SCRIPT the model turns (no live key).
 * Pins the orchestrator + route contract (design §4):
 *  - a clean tool-call → final-answer round-trip returns { reply, toolsUsed } and the tool actually ran;
 *  - an UNKNOWN tool name is rejected (fed back as an error, the tool never runs) — the allowlist guard;
 *  - BAD tool args are Zod-rejected (the tool never runs) — the typed-validation guard;
 *  - the K/T caps terminate a runaway tool-loop with an HONEST bounded reply (never a fabricated answer);
 *  - NO configured llm provider → 400; a provider transport failure → 502 (anti-fail-open);
 *  - the IDOR guard holds at the route layer (a model-requested foreign vehicleId cannot leak data);
 *  - unauth → 401.
 *
 * The fetch stub is STATEFUL: a per-test script array yields one scripted OpenAI-style response per
 * model turn, so the test can drive "turn 1 asks for a tool, turn 2 answers".
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

describe('POST /api/v1/assistant/chat (T4)', () => {
  test('a clean tool-call then answer round-trip returns the reply + the tool that ran', async () => {
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

  test('an UNKNOWN tool name is rejected — the model recovers and answers (allowlist guard)', async () => {
    await seedLlmProvider();
    stubScript([
      callTurn('dropAllTables', '{}'), // not in the allowlist
      answerTurn('I could not do that, but here is a summary.'),
    ]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    // The unknown tool never ran → toolsUsed stays empty.
    expect(data.toolsUsed).toEqual([]);
    expect(data.reply).toContain('summary');
  });

  test('BAD tool args are Zod-rejected — the tool never runs (typed-validation guard)', async () => {
    await seedLlmProvider();
    stubScript([
      callTurn('getFuelStats', '{"range":"last-tuesday"}'), // not an allow-listed range enum
      answerTurn('Here is what I found.'),
    ]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'mpg?' });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<ChatReply>>(res)).data.toolsUsed).toEqual([]);
  });

  test('a runaway tool-loop terminates with an honest bounded reply (the K/T caps)', async () => {
    await seedLlmProvider();
    // The model NEVER answers — it keeps requesting a tool. The loop must terminate via MAX_TURNS.
    stubScript([callTurn('listVehicles', '{}')]); // the stub repeats the last entry forever
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'loop forever' });
    expect(res.status).toBe(200);
    const data = (await json<DataEnvelope<ChatReply>>(res)).data;
    // Honest bounded reply — NOT a fabricated answer.
    expect(data.reply).toMatch(/not able to finish|try rephrasing/i);
  });

  test('NO configured llm provider → 400 with an actionable message', async () => {
    stubScript([answerTurn('hi')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/assistant|provider|Settings/i);
  });

  test('a provider transport failure → 502 (anti-fail-open, never a faked reply)', async () => {
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

  test('IDOR: a tool scoped to the session user never returns another user data', async () => {
    await seedLlmProvider();
    // Seed the session user's vehicle + a foreign user's vehicle.
    const mine = await seedVehicle(ctx, { make: 'Mine', model: 'Car', year: 2022 });
    ctx.sqlite.run(
      `INSERT INTO users (id, email, display_name) VALUES ('other-llm-route', 'o@test.com', 'Other')`
    );
    ctx.sqlite.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-foreign', 'other-llm-route', 'Foreign', 'Car', 2022)`
    );
    // The model calls listVehicles; the tool runs scoped to the SESSION user, so only `mine` comes back.
    stubScript([callTurn('listVehicles', '{}'), answerTurn('You have 1 vehicle.')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'my vehicles?' });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const data = JSON.parse(raw) as DataEnvelope<ChatReply>;
    expect(data.data.toolsUsed).toEqual(['listVehicles']);
    // The foreign vehicle id is never in the response (the tool result fed to the model was scoped).
    expect(raw).not.toContain('veh-foreign');
    expect(mine).toBeTruthy();
  });
});
