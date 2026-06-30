/**
 * LlmProvider — the strategy interface every LLM (assistant) adapter implements (llm-assistant T2/T3).
 * Mirrors the VLM domain's `VlmProvider` seam: the registry decrypts a `user_providers` row's
 * credentials and instantiates the correct adapter, and the orchestrator (T4) drives a bounded
 * tool-calling loop through `chat`. The adapters' live HTTP lands in T3; this file owns the contract so
 * behavior is identical across providers.
 *
 * The adapter is DUMB TRANSPORT (the load-bearing safety boundary, design §3/§4): it sends the messages
 * + the tool SCHEMAS in the provider's wire format and returns EITHER assistant text OR a list of
 * requested tool calls (name + raw JSON args). It NEVER executes a tool and NEVER trusts the args — the
 * orchestrator (T4) is the SOLE place that allowlist-checks the name, Zod-validates the args, and runs
 * the tool userId-scoped. This keeps the ARCC GenAI-tool-use discipline in exactly one audited spot.
 */

/** A single chat message in the transcript handed to the model. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For a `tool` message: which tool produced this result (the provider correlates it to its call). */
  toolName?: string;
  /** For an `assistant` message that requested tools: the provider's opaque call id (echoed back). */
  toolCallId?: string;
}

/** A tool the model may call — name + description + a JSON-schema for its arguments (from tools.ts). */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (draft-07-ish object) describing the tool's argument object. */
  parameters: Record<string, unknown>;
}

/** A tool call the model REQUESTED — UNTRUSTED. The orchestrator validates name + args before running. */
export interface ToolCall {
  /** The provider's opaque id for this call (echoed back with the tool result so the model correlates). */
  id: string;
  /** The requested tool name — MUST be allowlist-checked by the orchestrator (never trusted). */
  name: string;
  /** The raw arguments JSON string the model produced — MUST be Zod-validated before use. */
  argumentsJson: string;
}

/** The normalized result of one `chat` round: either final text, or a batch of requested tool calls. */
export interface ChatResult {
  /** The model's assistant text, if it produced a final answer this round (no tool calls). */
  text?: string;
  /** Tool calls the model requested this round (the orchestrator runs them, then calls chat again). */
  toolCalls?: ToolCall[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** The FIXED read-only tool allowlist (tools.ts) offered to the model this request. */
  tools: ToolDefinition[];
}

export interface LlmProvider {
  /**
   * Send the transcript + the tool definitions to the model and return its RAW response, normalized to
   * `{ text?, toolCalls? }`. MUST NOT execute tools or trust tool-call args — the orchestrator (T4) does
   * that. Throws on a transport/auth failure (the chat route maps that to a 502, never a fake success —
   * the #43/#44/#144 anti-fail-open lesson).
   */
  chat(request: ChatRequest): Promise<ChatResult>;
}
