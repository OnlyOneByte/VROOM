/**
 * Strategy interface for LLM adapters. Adapters are dumb transport: they must not execute tools or
 * trust tool-call args; the orchestrator is the only place those are checked.
 */

/** Untrusted: the orchestrator validates the name and the args before running anything. */
export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

/**
 * Every provider requires tool results to follow the assistant turn that requested them, so a tool
 * message is only valid after an assistant message whose toolCalls carries the matching id.
 */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolName: string; toolCallId: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the argument object. */
  parameters: Record<string, unknown>;
}

export interface ChatResult {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}

export interface LlmProvider {
  /** Throws on transport or auth failure so the route can answer 502. */
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** Native-API adapters need the args as an object; malformed model JSON degrades to {}. */
export function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
