/**
 * Bounded tool-calling loop. It is the only place model tool calls are checked: names against the
 * allowlist, args through the Zod schema, and execution scoped to the session user.
 */

import { logger } from '../../../../utils/logger';
import type { ChatMessage, LlmProvider, ToolCall } from './llm-provider';
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
  call: ToolCall,
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

/** Appends the assistant tool-call turn, then one result per call in the same order. */
async function appendToolTurn(
  messages: ChatMessage[],
  toolsUsed: string[],
  text: string,
  batch: ToolCall[],
  userId: string,
  nowMs: number
): Promise<void> {
  messages.push({ role: 'assistant', content: text, toolCalls: batch });
  for (const call of batch) {
    const { message, ran } = await runOneToolCall(call, userId, nowMs);
    if (ran) toolsUsed.push(call.name);
    messages.push(message);
  }
}

function finalReply(text: string | undefined): string {
  const reply = (text ?? '').trim();
  return reply.length > 0 ? reply : 'Sorry, I could not produce an answer for that.';
}

/**
 * Throws only on provider transport failure. Hitting the turn or tool-call cap without an answer
 * returns a bounded apology instead of a fabricated reply.
 */
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
    const requested = result.toolCalls ?? [];

    if (requested.length === 0) {
      return { reply: finalReply(result.text), toolsUsed };
    }

    // Every call echoed on the assistant turn must get a result, so calls past the budget are
    // dropped from the turn rather than left unanswered.
    const batch = requested.slice(0, toolCallBudget);
    if (batch.length === 0) break;
    toolCallBudget -= batch.length;

    await appendToolTurn(messages, toolsUsed, result.text ?? '', batch, userId, nowMs);
  }

  return {
    reply:
      'Sorry, I was not able to finish answering that. Please try rephrasing or asking something more specific.',
    toolsUsed,
  };
}
