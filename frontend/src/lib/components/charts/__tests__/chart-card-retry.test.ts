import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ChartCard from '../ChartCard.svelte';

const chart = createRawSnippet(() => ({ render: () => '<div>chart</div>' }));

function mount(onRetry?: () => unknown) {
	return render(ChartCard, {
		title: 'Mileage Over Time',
		error: 'Server unavailable.',
		onRetry,
		children: chart
	});
}

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>(r => (resolve = r));
	return { promise, resolve };
}

describe('ChartCard error retry', () => {
	test('the error state has no Retry unless the caller can retry', () => {
		mount();

		expect(screen.getByText("Couldn't load the chart")).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
	});

	test('Retry meets the 40px tap target', () => {
		mount(() => {});

		expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('h-10');
	});

	test('Retry stays focusable while it runs and ignores a second press', async () => {
		const pending = deferred();
		const onRetry = vi.fn(() => pending.promise);
		mount(onRetry);
		const button = screen.getByRole('button', { name: 'Retry' });
		button.focus();

		await fireEvent.click(button);
		await fireEvent.click(screen.getByRole('button', { name: /Retrying/ }));

		expect(onRetry).toHaveBeenCalledTimes(1);
		const running = screen.getByRole('button', { name: /Retrying/ });
		expect(running).toHaveAttribute('aria-disabled', 'true');
		expect(running).not.toBeDisabled();
		expect(document.activeElement).toBe(running);
		pending.resolve();
	});

	test('a retry that loads the chart moves focus to the card title', async () => {
		const loaded: { view?: ReturnType<typeof mount> } = {};
		loaded.view = mount(async () => {
			await loaded.view?.rerender({ error: null });
		});
		screen.getByRole('button', { name: 'Retry' }).focus();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());

		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByText('Mileage Over Time'))
		);
	});

	test('a retry that fails again keeps the error, Retry and focus', async () => {
		mount(async () => {});
		const button = screen.getByRole('button', { name: 'Retry' });
		button.focus();

		await fireEvent.click(button);

		const again = await screen.findByRole('button', { name: 'Retry' });
		expect(screen.getByText("Couldn't load the chart")).toBeInTheDocument();
		expect(document.activeElement).toBe(again);
	});
});
