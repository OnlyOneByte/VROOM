import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import QueryBar from '../QueryBar.svelte';
import { DEFAULT_EXPLORE } from '../query-state';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

async function openSplits(driverSplit: boolean) {
	render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange: () => {}, driverSplit } });
	await fireEvent.click(screen.getByRole('button', { name: /Split by/ }));
	await settle();
}

afterEach(() => cleanup());

describe('QueryBar driver split', () => {
	test('"Who paid" is offered only when one of the cars shares', async () => {
		await openSplits(true);
		expect(screen.getByRole('button', { name: 'Who paid' })).toBeTruthy();
	});

	test('without a shared car there is no "Who paid" split', async () => {
		await openSplits(false);
		expect(screen.queryByRole('button', { name: 'Who paid' })).toBeNull();
	});
});

describe('QueryBar chips', () => {
	test('each chip names its setting and current value', () => {
		render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange: () => {} } });
		for (const name of ['Metric Total cost', 'By Month', 'Split by Category', 'Compare None']) {
			expect(screen.getByRole('button', { name })).toBeTruthy();
		}
		expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
	});

	test('picking a value sends the query once, closes the menu and returns focus to the chip', async () => {
		const onChange = vi.fn();
		render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange } });
		await fireEvent.click(screen.getByRole('button', { name: 'By Month' }));
		await settle();
		const chip = screen.getByRole('button', { name: 'By Month' });
		expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
		await fireEvent.click(screen.getByRole('button', { name: 'Quarter' }));
		await settle();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EXPLORE, per: 'quarter' });
		expect(screen.queryByRole('button', { name: 'Quarter' })).toBeNull();
		expect(document.activeElement).toBe(chip);
	});

	test('picking the value already chosen only closes the menu', async () => {
		const onChange = vi.fn();
		render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange } });
		await fireEvent.click(screen.getByRole('button', { name: 'By Month' }));
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
		await settle();
		expect(onChange).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'Quarter' })).toBeNull();
	});

	test('a count keeps the running or all costs choice', async () => {
		render(QueryBar, {
			props: { query: { ...DEFAULT_EXPLORE, metric: 'count' }, onChange: () => {} }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Metric Number of expenses' }));
		await settle();
		expect(screen.getByRole('button', { name: 'All costs' })).toBeTruthy();
	});

	test('Copy link copies the page address', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange: () => {} } });
		await fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
		await settle();
		expect(writeText).toHaveBeenCalledWith(location.href);
		expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
	});
});
