import { expect } from 'bun:test';
import type { TestApp } from '../../../test-helpers/http-client';

export const LLM_API_KEY = 'sk-secret-llm-key';

export interface ChatReply {
  reply: string;
  toolsUsed: string[];
}

export interface SentBody {
  messages: Array<Record<string, unknown> & { role: string; content?: unknown }>;
}

export function callTurn(name: string, argsJson: string, id = 'c1'): Record<string, unknown> {
  return {
    choices: [{ message: { tool_calls: [{ id, function: { name, arguments: argsJson } }] } }],
  };
}

export function answerTurn(text: string): Record<string, unknown> {
  return { choices: [{ message: { content: text } }] };
}

export function stubScript(turns: Record<string, unknown>[]): SentBody[] {
  const sentBodies: SentBody[] = [];
  let idx = 0;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    if (init?.body) sentBodies.push(JSON.parse(init.body) as SentBody);
    const body = turns[Math.min(idx, turns.length - 1)];
    idx++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  }) as any;
  return sentBodies;
}

export function stubFailure(status: number): void {
  // biome-ignore lint/suspicious/noExplicitAny: test fetch stub.
  globalThis.fetch = (async () => new Response('upstream error', { status })) as any;
}

export async function seedLlmProvider(ctx: TestApp): Promise<void> {
  const res = await ctx.authed('POST', '/api/v1/providers', {
    domain: 'llm',
    providerType: 'openai-compatible',
    displayName: 'My Assistant',
    credentials: { apiKey: LLM_API_KEY },
    config: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  });
  expect(res.status).toBe(201);
}
