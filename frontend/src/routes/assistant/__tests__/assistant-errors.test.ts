import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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

	test('announces the assistant while it loads', async () => {
		getProviders.mockReturnValue(new Promise(() => {}));
		render(Page);

		expect(screen.getByRole('status')).toHaveTextContent('Loading the assistant');
	});

	test('Retry after a failed load opens the chat and puts focus in the question box', async () => {
		getProviders
			.mockRejectedValueOnce(new ApiError('Network error', 0))
			.mockResolvedValueOnce([{ id: 'p1' }]);
		render(Page);

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		const box = await screen.findByRole('textbox', { name: 'Your question' });
		await waitFor(() => expect(box).toHaveFocus());
	});

	test('a failed send is announced, and Retry sends the same question again', async () => {
		sendMessage
			.mockRejectedValueOnce(new ApiError('upstream 502', 502))
			.mockResolvedValueOnce({ reply: 'You spent $120.', toolsUsed: [] });
		await ask('How much did I spend?');

		expect(await screen.findByRole('alert')).toHaveTextContent(
			"The AI provider couldn't be reached."
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(await screen.findByText('You spent $120.')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(sendMessage).toHaveBeenLastCalledWith('How much did I spend?', []);
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

	test("a missing provider shows the server's reason", async () => {
		sendMessage.mockRejectedValue(
			new ApiError(
				'No assistant (LLM) provider is configured. Add one in Settings to use the assistant.',
				400
			)
		);
		await ask('How much did I spend?');

		expect(
			await screen.findByText(
				'No assistant (LLM) provider is configured. Add one in Settings to use the assistant.'
			)
		).toBeInTheDocument();
	});

	test('a NO_PROVIDER answer switches the page to the connect-a-provider prompt', async () => {
		sendMessage.mockRejectedValue(
			new ApiError(
				'No assistant (LLM) provider is configured.',
				400,
				{ capability: 'ai.llm' },
				'NO_PROVIDER'
			)
		);
		await ask('How much did I spend?');

		expect(await screen.findByText('No assistant provider connected')).toBeInTheDocument();
	});

	test('a message the server rejects as too long is not reported as a missing provider', async () => {
		sendMessage.mockRejectedValue(
			new ApiError('Invalid request data', 400, {
				issues: [
					{ path: ['message'], message: 'Too big: expected string to have <=2000 characters' }
				]
			})
		);
		await ask('How much did I spend?');

		expect(await screen.findByText('Check the message, then try again.')).toBeInTheDocument();
		expect(screen.queryByText(/provider/)).toBeNull();
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
