import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ChartLegend from '../ChartLegend.svelte';

const items = [
	{ key: 'fuel', label: 'Fuel', color: 'var(--chart-1)' },
	{ key: 'misc', label: 'Misc', color: 'var(--chart-2)' }
];

describe('ChartLegend', () => {
	test('without onToggle it stays a plain list', () => {
		render(ChartLegend, { items });
		expect(screen.getByRole('list')).toBeTruthy();
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('with onToggle each item is a pressed toggle that reports its key', async () => {
		const onToggle = vi.fn();
		render(ChartLegend, { items, hiddenKeys: ['misc'], onToggle });
		const fuel = screen.getByRole('button', { name: 'Fuel' });
		const misc = screen.getByRole('button', { name: 'Misc' });
		expect(fuel).toHaveAttribute('aria-pressed', 'true');
		expect(misc).toHaveAttribute('aria-pressed', 'false');
		await fireEvent.click(misc);
		expect(onToggle).toHaveBeenCalledWith('misc');
	});
});
