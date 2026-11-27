import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/settings/cards/ModelProvidersCard.svelte', async () => ({
	default: (await import('./SettingsChildStub.svelte')).default
}));

const AiPage = (await import('../ai/+page.svelte')).default;

afterEach(() => {
	cleanup();
});

describe('AI helpers page', () => {
	test('holds the receipt-scanning and assistant cards under its own heading', () => {
		render(AiPage);
		expect(screen.getByRole('heading', { level: 1, name: 'AI helpers' })).toBeInTheDocument();
		expect(screen.getByTestId('stub-model-vlm')).toBeInTheDocument();
		expect(screen.getByTestId('stub-model-llm')).toBeInTheDocument();
		expect(
			screen
				.getByTestId('stub-model-vlm')
				.compareDocumentPosition(screen.getByTestId('stub-model-llm')) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	test('leads back to Settings', () => {
		render(AiPage);
		expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
			'href',
			'/settings'
		);
	});
});
