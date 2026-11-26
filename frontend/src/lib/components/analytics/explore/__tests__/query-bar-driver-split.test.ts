import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import QueryBar from '../QueryBar.svelte';
import { DEFAULT_EXPLORE } from '../query-state';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

async function openSplits(driverSplit: boolean) {
	render(QueryBar, { props: { query: DEFAULT_EXPLORE, onChange: () => {}, driverSplit } });
	await fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
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
