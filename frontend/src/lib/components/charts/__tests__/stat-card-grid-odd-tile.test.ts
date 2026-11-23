import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import StatCardGrid from '../StatCardGrid.svelte';

afterEach(() => cleanup());

function tiles(count: number, columns?: 2 | 3 | 4) {
	const items = Array.from({ length: count }, (_, i) => ({ label: `Tile ${i}`, value: i }));
	const { container } = render(StatCardGrid, { props: { items, ...(columns && { columns }) } });
	const grid = container.firstElementChild as HTMLElement;
	return { grid, cards: [...grid.querySelectorAll(':scope > [data-slot="card"]')] };
}

describe('StatCardGrid leaves no orphan tile', () => {
	test('three tiles join into one tile of three rows below sm and sit 3-up from sm', () => {
		const { grid, cards } = tiles(3, 3);
		expect(grid).toHaveClass(
			'max-sm:grid-cols-1',
			'sm:grid-cols-3',
			'max-sm:border',
			'max-sm:gap-0'
		);
		expect(grid.className).toContain('max-sm:[&_[data-stat-icon]]:hidden');
		for (const card of cards) expect(card).not.toHaveClass('col-span-2');
		expect(cards[0]).not.toHaveClass('max-sm:border-t');
		expect(cards[1]).toHaveClass('max-sm:border-0', 'max-sm:border-t');
		expect(cards[2]).toHaveClass('max-sm:border-0', 'max-sm:border-t');
	});

	test('three two-value tiles take one row each below sm, never a joined tile', () => {
		const items = Array.from({ length: 3 }, (_, i) => ({
			label: `Tile ${i}`,
			value: i,
			secondaryLabel: `Other ${i}`,
			secondaryValue: i
		}));
		const { container } = render(StatCardGrid, { props: { items, columns: 3 } });
		const grid = container.firstElementChild as HTMLElement;
		const cards = [...grid.querySelectorAll(':scope > [data-slot="card"]')];
		expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3');
		expect(grid).not.toHaveClass('max-sm:border');
		expect(cards[2]).toHaveClass('sm:col-span-2', 'lg:col-span-1');
		expect(cards[2]).not.toHaveClass('col-span-2');
	});

	test('a five-tile row spans its odd last tile across both mobile columns', () => {
		const { cards } = tiles(5, 4);
		expect(cards[4]).toHaveClass('col-span-2', 'lg:col-span-1');
	});

	test('an even count keeps every tile in one column', () => {
		const { cards } = tiles(4);
		for (const card of cards) expect(card).not.toHaveClass('col-span-2');
	});

	test('a lone tile spans the row at every width', () => {
		const { cards } = tiles(1);
		expect(cards[0]).toHaveClass('col-span-2');
		expect(cards[0]).not.toHaveClass('lg:col-span-1');
	});

	test('the lg column count never exceeds the number of tiles', () => {
		expect(tiles(2, 3).grid).toHaveClass('lg:grid-cols-2');
		cleanup();
		expect(tiles(3, 4).grid).toHaveClass('sm:grid-cols-3');
		cleanup();
		expect(tiles(5, 4).grid).toHaveClass('lg:grid-cols-4');
	});
});
