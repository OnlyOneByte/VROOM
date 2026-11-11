/**
 * Strategy interface for LLM adapters. Adapters are dumb transport: they must not execute tools or
 * trust tool-call args; the orchestrator is the only place those are checked.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the argument object. */
  parameters: Record<string, unknown>;
}

/** Untrusted: the orchestrator validates the name and the args before running anything. */
export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
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
