import { apiClient } from './api-client';

export interface AssistantTurn {
	role: 'user' | 'assistant';
	content: string;
}

export interface AssistantReply {
	reply: string;
	toolsUsed: string[];
}

export const assistantApi = {
	async sendMessage(message: string, history: AssistantTurn[] = []): Promise<AssistantReply> {
		return apiClient.post<AssistantReply>('/api/v1/assistant/chat', { message, history });
	}
};
