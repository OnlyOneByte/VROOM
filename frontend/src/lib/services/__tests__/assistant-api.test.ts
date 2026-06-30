/**
 * assistant-api.ts client (llm-assistant T5a) — the C149/C163 service-test pattern: apiClient is mocked
 * so we assert the exact endpoint + payload sendMessage builds, and that it returns the {reply, toolsUsed}
 * envelope. The fork-free FE wrapper over the shipped POST /api/v1/assistant/chat.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const post = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { post },
	getApiBaseUrl: () => ''
}));

const { assistantApi } = await import('../assistant-api');

beforeEach(() => {
	post.mockReset();
});

describe('assistantApi.sendMessage', () => {
	test('POSTs { message, history } to /api/v1/assistant/chat and returns the reply envelope', async () => {
		post.mockResolvedValue({ reply: 'You spent $50 on fuel.', toolsUsed: ['getExpenseSummary'] });

		const out = await assistantApi.sendMessage('How much on fuel?', [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'Hello!' }
		]);

		expect(post).toHaveBeenCalledTimes(1);
		const call = post.mock.calls[0] ?? [];
		expect(call[0]).toBe('/api/v1/assistant/chat');
		expect(call[1]).toEqual({
			message: 'How much on fuel?',
			history: [
				{ role: 'user', content: 'hi' },
				{ role: 'assistant', content: 'Hello!' }
			]
		});
		expect(out).toEqual({ reply: 'You spent $50 on fuel.', toolsUsed: ['getExpenseSummary'] });
	});

	test('defaults history to an empty array when omitted', async () => {
		post.mockResolvedValue({ reply: 'Hi!', toolsUsed: [] });
		await assistantApi.sendMessage('hello');
		expect(post.mock.calls[0]?.[1]).toEqual({ message: 'hello', history: [] });
	});

	test('propagates a client error (e.g. no provider configured / provider unreachable)', async () => {
		post.mockRejectedValue(new Error('No assistant (LLM) provider is configured.'));
		await expect(assistantApi.sendMessage('hi')).rejects.toThrow(/LLM\) provider is configured/);
	});
});
