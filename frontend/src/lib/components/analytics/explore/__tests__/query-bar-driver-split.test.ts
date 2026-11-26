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
		expect(screen.getByLabelText('Who paid')).toBeTruthy();
	});

	test('without a shared car there is no "Who paid" split', async () => {
		await openSplits(false);
		expect(screen.queryByLabelText('Who paid')).toBeNull();
	});
});

describe('QueryBar chips', () => {
	test('each chip names its setting and current value', () => {
		render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange: () => {} } });
		for (const name of ['Metric Running cost', 'By Month', 'Split by Category', 'Compare None']) {
			expect(screen.getByRole('button', { name })).toBeTruthy();
		}
		expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
	});

	test('picking a value sends the new query and closes the menu', async () => {
		const onChange = vi.fn();
		render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange } });
		await fireEvent.click(screen.getByRole('button', { name: 'By Month' }));
		await settle();
		await fireEvent.click(screen.getByLabelText('Quarter'));
		await settle();
		expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_EXPLORE, per: 'quarter' });
		expect(screen.queryByLabelText('Quarter')).toBeNull();
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
