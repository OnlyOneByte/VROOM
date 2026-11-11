import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../../../test-helpers/http-client';
import type { ChatMessage, ChatRequest, ChatResult, LlmProvider, ToolCall } from '../llm-provider';

type OrchestratorModule = typeof import('../orchestrator');

let ctx: TestApp;
let orchestrator: OrchestratorModule;
const NOW_MS = 1_900_000_000_000;

beforeEach(async () => {
  ctx = await createTestApp();
  orchestrator = await import('../orchestrator');
});
afterEach(() => ctx.close());

/** Replays scripted results (repeating the last) and records a snapshot of every request. */
function scriptedProvider(results: ChatResult[]): { provider: LlmProvider; sent: ChatMessage[][] } {
  const sent: ChatMessage[][] = [];
  let i = 0;
  const provider: LlmProvider = {
    chat: async (request: ChatRequest) => {
      sent.push(structuredClone(request.messages));
      return results[Math.min(i++, results.length - 1)] ?? { text: '' };
    },
  };
  return { provider, sent };
}

function calls(n: number, prefix: string): ToolCall[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    name: 'listVehicles',
    argumentsJson: '{}',
  }));
}

/** Every assistant tool call must be answered, in order, by the tool messages right after it. */
function expectWellFormedToolProtocol(messages: ChatMessage[]): void {
  let unanswered: string[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      expect(m.toolCallId).toBe(unanswered[0] ?? '<no open tool call>');
      unanswered = unanswered.slice(1);
      continue;
    }
    expect(unanswered).toEqual([]);
    unanswered = m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : [];
  }
  expect(unanswered).toEqual([]);
}

describe('runAssistant tool-call transcript', () => {
  test('tool results follow an assistant turn that carries the requested tool calls', async () => {
    const call: ToolCall = { id: 'call_x', name: 'listVehicles', argumentsJson: '{}' };
    const { provider, sent } = scriptedProvider([
      { text: 'Let me look.', toolCalls: [call] },
      { text: 'You have no vehicles.' },
    ]);

    const result = await orchestrator.runAssistant(provider, ctx.user.id, 'cars?', [], NOW_MS);

    expect(result).toEqual({ reply: 'You have no vehicles.', toolsUsed: ['listVehicles'] });
    expect(sent).toHaveLength(2);
    const second = sent[1] ?? [];
    expect(second.slice(2)).toEqual([
      { role: 'assistant', content: 'Let me look.', toolCalls: [call] },
      { role: 'tool', content: '[]', toolName: 'listVehicles', toolCallId: 'call_x' },
    ]);
    expectWellFormedToolProtocol(second);
  });

  test('calls past the budget are dropped from the assistant turn, so none is left unanswered', async () => {
    const { MAX_TOOL_CALLS } = orchestrator;
    const { provider, sent } = scriptedProvider([
      { toolCalls: calls(MAX_TOOL_CALLS - 1, 'a') },
      { toolCalls: calls(3, 'b') },
      { toolCalls: calls(1, 'c') },
    ]);

    const result = await orchestrator.runAssistant(provider, ctx.user.id, 'loop', [], NOW_MS);

    expect(result.toolsUsed).toHaveLength(MAX_TOOL_CALLS);
    expect(result.reply).toMatch(/not able to finish/);
    // The third request sees the second turn trimmed to the one call the budget still allowed.
    const third = sent[2] ?? [];
    const assistantTurns = third.filter((m) => m.role === 'assistant');
    expect(assistantTurns.map((m) => m.toolCalls?.map((c) => c.id))).toEqual([
      calls(MAX_TOOL_CALLS - 1, 'a').map((c) => c.id),
      ['b0'],
    ]);
    expectWellFormedToolProtocol(third);
    // Once the budget is spent the loop stops instead of resending a transcript it cannot extend.
    expect(sent).toHaveLength(3);
  });

  test('unknown tools still get a result message so the transcript stays well-formed', async () => {
    const { provider, sent } = scriptedProvider([
      { toolCalls: [{ id: 'u1', name: 'dropAllTables', argumentsJson: '{}' }] },
      { text: 'Sorry.' },
    ]);

    const result = await orchestrator.runAssistant(provider, ctx.user.id, 'hi', [], NOW_MS);

    expect(result.toolsUsed).toEqual([]);
    const second = sent[1] ?? [];
    expectWellFormedToolProtocol(second);
    const last = second[second.length - 1];
    expect(last?.role === 'tool' && last.content).toContain('unknown tool');
  });
});
