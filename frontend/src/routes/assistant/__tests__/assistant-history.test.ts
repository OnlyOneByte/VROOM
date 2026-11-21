import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

type Turn = { role: string; content: string };
const { getProviders, sendMessage } = vi.hoisted(() => ({
	getProviders: vi.fn<(domain?: string) => Promise<unknown[]>>(),
	sendMessage: vi.fn<(text: string, history: Turn[]) => Promise<unknown>>()
}));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: (domain?: string) => getProviders(domain) }
}));
vi.mock('#lib/services/assistant-api.ts', () => ({
	assistantApi: { sendMessage: (text: string, history: Turn[]) => sendMessage(text, history) }
}));

const Page = (await import('../+page.svelte')).default;

const LONG_REPLY = 'Fuel '.repeat(1000);

async function say(text: string) {
	const box = screen.getByPlaceholderText('Ask about your vehicles and costs…');
	await fireEvent.input(box, { target: { value: text } });
	await fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

beforeEach(() => {
	getProviders.mockReset().mockResolvedValue([{ id: 'p1' }]);
	sendMessage.mockReset().mockResolvedValue({ reply: LONG_REPLY, toolsUsed: [] });
	localStorage.setItem('vroom.llm.assistant-disclosed', '1');
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe('assistant history', () => {
	test('a long earlier reply is trimmed to the server limit in the next message', async () => {
		render(Page);
		await screen.findByPlaceholderText('Ask about your vehicles and costs…');

		await say('Summarize my fuel costs');
		await screen.findByText(/Fuel Fuel/);
		await say('And last month?');

		const [, history] = sendMessage.mock.calls.at(-1)!;
		const reply = history.find(turn => turn.role === 'assistant')!;
		expect(reply.content).toHaveLength(2000);
		expect(reply.content.startsWith('Fuel Fuel')).toBe(true);
		expect(reply.content.endsWith('…')).toBe(true);
		expect(history.every(turn => turn.content.length <= 2000)).toBe(true);
	});

	test('a retry sends the same trimmed history', async () => {
		render(Page);
		await screen.findByPlaceholderText('Ask about your vehicles and costs…');
		await say('Summarize my fuel costs');
		await screen.findByText(/Fuel Fuel/);

		sendMessage.mockRejectedValueOnce(new ApiError('upstream', 502));
		await say('And last month?');
		await fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

		const [, history] = sendMessage.mock.calls.at(-1)!;
		expect(history.map(turn => turn.content.length)).toEqual([23, 2000]);
	});

	test('the message box stops at the server limit', async () => {
		render(Page);
		const box = await screen.findByPlaceholderText('Ask about your vehicles and costs…');

		expect(box).toHaveAttribute('maxlength', '2000');
	});
});
