/**
 * Client for the read-only assistant, which answers questions over the user's own car data and never
 * writes. The reply is plain text or safe markdown that callers render; it is never executed.
 */

import { apiClient } from './api-client';

/** Only user and assistant turns; the backend rejects tool turns sent by the client. */
export interface AssistantTurn {
	role: 'user' | 'assistant';
	content: string;
}

/** toolsUsed is informational; it is not proof that the reply is grounded. */
export interface AssistantReply {
	reply: string;
	toolsUsed: string[];
}

export const assistantApi = {
	// Throws ApiError on non-2xx (e.g. 400 when no LLM provider is configured, 502 when unreachable).
	// Persists nothing server-side; the transcript lives in the client.
	async sendMessage(message: string, history: AssistantTurn[] = []): Promise<AssistantReply> {
		return apiClient.post<AssistantReply>('/api/v1/assistant/chat', { message, history });
	}
};
