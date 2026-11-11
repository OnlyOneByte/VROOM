/**
 * Bounded tool-calling loop. It is the only place model tool calls are checked: names against the
 * allowlist, args through the Zod schema, and execution scoped to the session user.
 */

import { logger } from '../../../../utils/logger';
import type { ChatMessage, LlmProvider } from './llm-provider';
import { ASSISTANT_TOOLS, toolDefinitions } from './tools';

export const MAX_TOOL_CALLS = 5;
export const MAX_TURNS = 4;

// Constant by design: never build this from user input.
const SYSTEM_PROMPT = [
  'You are VROOM, a helpful assistant for a personal car-expense tracker. Answer the user questions',
  'about THEIR OWN vehicles and spending using ONLY the data the provided tools return — never invent',
  'numbers. Call a tool when you need data; once you have enough, give a concise, friendly answer in',
  'plain text (you may use simple markdown). If a tool returns nothing useful or you cannot answer from',
  'the available tools, say so honestly rather than guessing. All amounts are in the user currency.',
].join(' ');

export interface AssistantChatResult {
  reply: string;
  /** Which tools actually ran (transparency for the UI — NOT trusted for any decision). */
  toolsUsed: string[];
}

function toolMessage(name: string, id: string, content: string): ChatMessage {
  return { role: 'tool', content, toolName: name, toolCallId: id };
}

/** Unknown names, bad args and tool throws all become error messages for the model, never a 500. */
async function runOneToolCall(
  call: { id: string; name: string; argumentsJson: string },
  userId: string,
  nowMs: number
): Promise<{ message: ChatMessage; ran: boolean }> {
  const tool = ASSISTANT_TOOLS[call.name];
  if (!tool) {
    return {
      message: toolMessage(call.name, call.id, `Error: unknown tool "${call.name}".`),
      ran: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(call.argumentsJson);
  } catch {
    parsed = {};
  }
  const valid = tool.schema.safeParse(parsed);
  if (!valid.success) {
    return {
      message: toolMessage(call.name, call.id, `Error: invalid arguments for "${call.name}".`),
      ran: false,
    };
  }

  try {
    const out = await tool.run(valid.data, userId, nowMs);
    return { message: toolMessage(call.name, call.id, JSON.stringify(out)), ran: true };
  } catch (err) {
    const m = err instanceof Error ? err.message : 'tool error';
    logger.warn('Assistant tool failed', { tool: call.name, error: m });
    return {
      message: toolMessage(call.name, call.id, `Error: could not run "${call.name}".`),
      ran: false,
    };
  }
}

/**
 * Throws only on provider transport failure. Hitting the turn cap without an answer returns a bounded
 * apology instead of a fabricated reply.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the bounded turn-loop with its early-exit branches (final answer / tool batch / cap exhaustion) IS the design-§4 structure; the per-tool-call dispatch is already extracted to runOneToolCall, so the remaining complexity is the loop shape itself — splitting it further would obscure the safety-critical control flow.
export async function runAssistant(
  provider: LlmProvider,
  userId: string,
  message: string,
  history: ChatMessage[],
  nowMs: number
): Promise<AssistantChatResult> {
  const tools = toolDefinitions();
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ];
  const toolsUsed: string[] = [];
  let toolCallBudget = MAX_TOOL_CALLS;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const result = await provider.chat({ messages, tools });

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const reply = (result.text ?? '').trim();
      return {
        reply: reply.length > 0 ? reply : 'Sorry, I could not produce an answer for that.',
        toolsUsed,
      };
    }

    // Providers expect an assistant turn before its tool results; the transcript is resent each turn.
    messages.push({ role: 'assistant', content: '' });

    for (const call of result.toolCalls) {
      if (toolCallBudget <= 0) break;
      toolCallBudget--;
      const { message, ran } = await runOneToolCall(call, userId, nowMs);
      if (ran) toolsUsed.push(call.name);
      messages.push(message);
    }
  }

  return {
    reply:
      'Sorry, I was not able to finish answering that. Please try rephrasing or asking something more specific.',
    toolsUsed,
  };
}
