import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const { getProviders, sendMessage } = vi.hoisted(() => ({
	getProviders: vi.fn<(domain?: string) => Promise<unknown[]>>(),
	sendMessage: vi.fn<(text: string, history: unknown[]) => Promise<unknown>>()
}));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: (domain?: string) => getProviders(domain) }
}));
vi.mock('#lib/services/assistant-api.ts', () => ({
	assistantApi: {
		sendMessage: (text: string, history: unknown[]) => sendMessage(text, history)
	}
}));

const Page = (await import('../+page.svelte')).default;

async function ask(text: string) {
	render(Page);
	const box = await screen.findByPlaceholderText('Ask about your vehicles and costs…');
	await fireEvent.input(box, { target: { value: text } });
	await fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
}

beforeEach(() => {
	getProviders.mockReset().mockResolvedValue([{ id: 'p1' }]);
	sendMessage.mockReset();
	localStorage.setItem('vroom.llm.assistant-disclosed', '1');
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe('assistant page errors', () => {
	test('a server failure while checking providers is a plain sentence, not the raw text', async () => {
		getProviders.mockRejectedValue(new ApiError('SQLITE_BUSY: database is locked', 500));
		render(Page);

		expect(await screen.findByText("Couldn't load the assistant")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText(/SQLITE_BUSY/)).toBeNull();
	});

	test('an unreachable provider says so', async () => {
		sendMessage.mockRejectedValue(new ApiError('upstream 502', 502));
		await ask('How much did I spend?');

		expect(
			await screen.findByText(
				"The AI provider couldn't be reached. Check the key and model in Settings, then try again."
			)
		).toBeInTheDocument();
	});

	test.each([
		[new ApiError('TypeError: cannot read properties of undefined', 500), SERVER_FAILURE_MESSAGE],
		['boom', UNEXPECTED_FAILURE_MESSAGE]
	])('any other send failure falls back to the shared sentence (%s)', async (error, message) => {
		sendMessage.mockRejectedValue(error);
		await ask('How much did I spend?');

		expect(await screen.findByText(message)).toBeInTheDocument();
		expect(screen.queryByText(/TypeError/)).toBeNull();
	});
});
