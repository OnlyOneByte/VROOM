export interface ToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

// Tool results must follow the assistant turn whose toolCalls carry their ids.
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolName: string; toolCallId: string };

export interface ToolDefinition {
  name: string;
  description: string;
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
  chat(request: ChatRequest): Promise<ChatResult>;
}

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
