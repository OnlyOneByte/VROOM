import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import {
  answerTurn,
  type ChatReply,
  callTurn,
  LLM_API_KEY,
  seedLlmProvider,
  stubFailure,
  stubScript,
} from './assistant-test-helpers';

let ctx: TestApp;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => {
  globalThis.fetch = realFetch;
  ctx.close();
});

describe('POST /api/v1/assistant/chat', () => {
  test('a tool call followed by an answer returns the reply and the tool that ran', async () => {
    await seedLlmProvider(ctx);
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
    await seedLlmProvider(ctx);
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
    await seedLlmProvider(ctx);
    stubScript([
      callTurn('getFuelStats', '{"range":"last-tuesday"}'),
      answerTurn('Here is what I found.'),
    ]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'mpg?' });
    expect(res.status).toBe(200);
    expect((await json<DataEnvelope<ChatReply>>(res)).data.toolsUsed).toEqual([]);
  });

  test('a runaway tool loop stops with an honest bounded reply', async () => {
    await seedLlmProvider(ctx);
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

  test.each([
    [401, 502, "didn't accept its key"],
    [429, 503, 'limiting requests'],
    [503, 502, 'could not be reached'],
  ])(
    'a provider HTTP %i answers %i saying what went wrong, never a faked reply',
    async (upstream, status, text) => {
      await seedLlmProvider(ctx);
      stubFailure(upstream);
      const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
      expect(res.status).toBe(status);
      expect(await res.text()).toContain(text);
    }
  );

  test('the api key is never echoed in the response', async () => {
    await seedLlmProvider(ctx);
    stubScript([answerTurn('done')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(await res.text()).not.toContain(LLM_API_KEY);
  });

  test('an empty message is rejected (400, zValidator)', async () => {
    await seedLlmProvider(ctx);
    stubScript([answerTurn('hi')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', { message: '' });
    expect(res.status).toBe(400);
  });

  test('analytics tools group by the timeZone the client sends', async () => {
    await seedLlmProvider(ctx);
    const vehicleId = await seedVehicle(ctx);
    ctx.sqlite.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, expense_amount, date) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'jan-1-auckland',
        vehicleId,
        ctx.user.id,
        'maintenance',
        5000,
        Math.floor(Date.parse('2024-12-31T23:00:00.000Z') / 1000),
      ]
    );
    const toolResultMonths = async (timeZone?: string) => {
      const sent = stubScript([
        callTurn('getCrossVehicle', '{"range":"all"}'),
        answerTurn('Done.'),
      ]);
      const res = await ctx.authed('POST', '/api/v1/assistant/chat', {
        message: 'monthly spend?',
        ...(timeZone ? { timeZone } : {}),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const toolMessage = sent[1]?.messages.find((m) => m.role === 'tool');
      const out = JSON.parse(String(toolMessage?.content)) as {
        monthlyExpenseTrends: Array<{ month: string }>;
      };
      return out.monthlyExpenseTrends.map((t) => t.month);
    };

    expect(await toolResultMonths('Pacific/Auckland')).toEqual(['2025-01']);
    expect(await toolResultMonths()).toEqual(['2024-12']);
  });

  test('an unknown timeZone is rejected (400)', async () => {
    await seedLlmProvider(ctx);
    stubScript([answerTurn('hi')]);
    const res = await ctx.authed('POST', '/api/v1/assistant/chat', {
      message: 'hi',
      timeZone: 'Mars/Olympus_Mons',
    });
    expect(res.status).toBe(400);
  });

  test('an unauthenticated request is rejected (401)', async () => {
    const res = await ctx.anon('POST', '/api/v1/assistant/chat', { message: 'hi' });
    expect(res.status).toBe(401);
  });

  test('tools only return the session user’s data', async () => {
    await seedLlmProvider(ctx);
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
