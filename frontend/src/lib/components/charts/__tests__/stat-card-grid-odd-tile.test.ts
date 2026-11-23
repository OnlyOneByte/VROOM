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
	test('an odd last tile spans both mobile columns and one column from lg', () => {
		const { cards } = tiles(3, 3);
		expect(cards[2]).toHaveClass('col-span-2', 'lg:col-span-1');
		expect(cards[0]).not.toHaveClass('col-span-2');
		expect(cards[1]).not.toHaveClass('col-span-2');
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
		expect(tiles(3, 3).grid).toHaveClass('lg:grid-cols-3');
		cleanup();
		expect(tiles(5, 4).grid).toHaveClass('lg:grid-cols-4');
	});
});
