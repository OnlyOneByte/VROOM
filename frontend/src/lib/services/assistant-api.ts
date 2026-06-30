/**
 * LLM assistant API client (llm-assistant T5a — the fork-free FE slice).
 *
 * A thin typed wrapper over the already-shipped, contract-fixed `POST /api/v1/assistant/chat` (backend
 * T4): send a user message (+ the bounded prior transcript) and get back a grounded reply + the tools
 * that ran. This is independent of the gated forks — D1 (which adapters ship), D5 (streaming), D6 (caps)
 * — so it carries zero rework risk regardless of how those land. The settings provider card + the chat
 * surface (the eyes-on, D1/D5-dependent parts of T5b/T6) stay gated.
 *
 * The assistant is READ-ONLY (v1): it answers questions over the user's own car data; it never writes.
 * The reply is plain text / safe markdown the caller renders — never executed.
 */

import { apiClient } from './api-client';

/** A prior conversation turn the client sends back for context. Only user/assistant — tool turns are
 *  produced server-side by the orchestrator and never sent from the client (the backend rejects them). */
export interface AssistantTurn {
	role: 'user' | 'assistant';
	content: string;
}

/** The assistant's grounded answer + which read-only tools actually ran (transparency, not trusted). */
export interface AssistantReply {
	reply: string;
	toolsUsed: string[];
}

export const assistantApi = {
	/**
	 * Ask the assistant a question over the user's own car data. POSTs the message (+ a bounded prior
	 * transcript) to the backend, which runs the bounded tool-calling loop and returns a grounded reply.
	 * Throws an ApiError (via the shared client) on a non-2xx — e.g. 400 if no LLM provider is configured,
	 * 502 if the provider could not be reached — so the caller can show an actionable message + a retry.
	 * PERSISTS NOTHING server-side (the transcript lives in the client).
	 */
	async sendMessage(message: string, history: AssistantTurn[] = []): Promise<AssistantReply> {
		return apiClient.post<AssistantReply>('/api/v1/assistant/chat', { message, history });
	}
};
