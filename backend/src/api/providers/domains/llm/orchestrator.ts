/**
 * The bounded tool-calling orchestrator (llm-assistant T4) — the loop that turns a user message into a
 * grounded answer (design §4). This is where the ARCC GenAI-tool-use discipline is ENFORCED: the adapter
 * is dumb transport, but THIS loop allowlist-checks every tool name, Zod-validates the args against the
 * T2 tool schema, runs the tool userId-scoped (the session userId — NEVER a model-supplied id), feeds the
 * result back, and hard-caps the loop. The model's free-text output is never used for a security decision.
 *
 * Read-only (design §8.1): no tool mutates anything, so there is no model-driven write path to secure.
 * Authorization is never the model's (R5): every tool runs with the userId this function is called with.
 */

import { logger } from '../../../../utils/logger';
import type { ChatMessage, LlmProvider } from './llm-provider';
import { ASSISTANT_TOOLS, toolDefinitions } from './tools';

/** D6 (recommended): hard caps so a runaway model loop cannot rack up the user's API cost / hammer the DB. */
export const MAX_TOOL_CALLS = 5;
export const MAX_TURNS = 4;

/** The fixed system instruction. CONSTANT (never built from user input) — prompt hardening (SAX-04). */
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

/** A `tool`-role message to feed the validated/erroring tool result back to the model next turn. */
function toolMessage(name: string, id: string, content: string): ChatMessage {
  return { role: 'tool', content, toolName: name, toolCallId: id };
}

/**
 * Run ONE requested tool call through the three ARCC guards (allowlist → Zod-validate → session-scoped
 * execution) and return the `tool` message to feed back. NEVER trusts the model: an unknown name, bad
 * args, or a tool throw (e.g. the confused-deputy guard) all become an error message, not a run/throw.
 */
async function runOneToolCall(
  call: { id: string; name: string; argumentsJson: string },
  userId: string,
  nowMs: number
): Promise<{ message: ChatMessage; ran: boolean }> {
  const tool = ASSISTANT_TOOLS[call.name];
  if (!tool) {
    // (a) allowlist guard — the model named a tool we did not pre-specify. Feed an error, do not run.
    return {
      message: toolMessage(call.name, call.id, `Error: unknown tool "${call.name}".`),
      ran: false,
    };
  }

  // (b) typed validation — parse the model's RAW args through the tool's strict Zod schema. A bad/
  // injection arg fails here and never reaches the repo (args go to the repo as a typed object).
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

  // (c) session-scoped execution — run the tool under the SESSION userId (never a model-supplied id).
  try {
    const out = await tool.run(valid.data, userId, nowMs);
    return { message: toolMessage(call.name, call.id, JSON.stringify(out)), ran: true };
  } catch (err) {
    // A tool throw (e.g. the confused-deputy guard on a foreign vehicleId) is fed back as an error
    // message — NOT a fake answer, NOT a 500 (the model can recover or apologize).
    const m = err instanceof Error ? err.message : 'tool error';
    logger.warn('Assistant tool failed', { tool: call.name, error: m });
    return {
      message: toolMessage(call.name, call.id, `Error: could not run "${call.name}".`),
      ran: false,
    };
  }
}

/**
 * Run the bounded tool-calling loop for one chat request. `userId` is the AUTHENTICATED session user —
 * every tool executes scoped to it. `history` is the bounded prior transcript the client sent (already
 * length-bounded by the route). Returns the model's final grounded text + the tools that ran.
 *
 * Throws only on a provider transport failure (the route maps it to 502). A loop that exhausts its caps
 * WITHOUT a final answer returns an honest bounded reply (never a fabricated success — anti-fail-open).
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

    // No tool calls → the model produced its final answer (or an empty one → a generic fallback).
    if (!result.toolCalls || result.toolCalls.length === 0) {
      const reply = (result.text ?? '').trim();
      return {
        reply: reply.length > 0 ? reply : 'Sorry, I could not produce an answer for that.',
        toolsUsed,
      };
    }

    // Echo the assistant's tool-call turn back so the provider can correlate the results (OpenAI/Anthropic
    // both expect the assistant turn before its tool results; a compact textual placeholder suffices for
    // our stateless re-send since we resend the whole transcript each turn).
    messages.push({ role: 'assistant', content: '' });

    for (const call of result.toolCalls) {
      if (toolCallBudget <= 0) break; // D6: stop dispatching once the per-request tool budget is spent
      toolCallBudget--;
      const { message, ran } = await runOneToolCall(call, userId, nowMs);
      if (ran) toolsUsed.push(call.name);
      messages.push(message);
    }
  }

  // (d) loop exhausted (hit MAX_TURNS without a final answer) — an HONEST bounded reply, never a fabrication.
  return {
    reply:
      'Sorry, I was not able to finish answering that. Please try rephrasing or asking something more specific.',
    toolsUsed,
  };
}
