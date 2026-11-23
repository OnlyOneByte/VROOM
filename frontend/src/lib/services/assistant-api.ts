import { userTimeZone } from './analytics-api';
import { apiClient } from './api-client';

export interface AssistantTurn {
	role: 'user' | 'assistant';
	content: string;
}

interface AssistantReply {
	reply: string;
	toolsUsed: string[];
}

export const assistantApi = {
	async sendMessage(message: string, history: AssistantTurn[] = []): Promise<AssistantReply> {
		return apiClient.post<AssistantReply>('/assistant/chat', {
			message,
			history,
			timeZone: userTimeZone()
		});
	}
};
