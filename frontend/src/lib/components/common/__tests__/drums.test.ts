import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('svelte/motion', async importOriginal => ({
	...(await importOriginal<typeof import('svelte/motion')>()),
	prefersReducedMotion: {
		get current() {
			return motion.reduce;
		}
	}
}));

const Drums = (await import('../Drums.svelte')).default;

function cells(container: HTMLElement) {
	return [...container.querySelectorAll<HTMLElement>('[data-kind]')].map(cell => [
		cell.dataset['kind'],
		cell.textContent
	]);
}

afterEach(() => {
	cleanup();
	motion.reduce = false;
});

describe('Drums', () => {
	test('whole dollars: a symbol cell then one cell per digit, read as the amount', () => {
		const { container } = render(Drums, { props: { amount: 501, currency: 'USD' } });
		expect(screen.getByRole('img', { name: '$501' })).toBeInTheDocument();
		expect(cells(container)).toEqual([
			['sep', '$'],
			['digit', '5'],
			['digit', '0'],
			['digit', '1']
		]);
	});

	test('thousands separators are not drawn, but the label keeps them', () => {
		const { container } = render(Drums, { props: { amount: 13061, currency: 'USD' } });
		expect(screen.getByRole('img', { name: '$13,061' })).toBeInTheDocument();
		expect(cells(container).map(([, char]) => char)).toEqual(['$', '1', '3', '0', '6', '1']);
	});

	test('with cents, the fraction sits in its own cream cells after the decimal point', () => {
		const { container } = render(Drums, {
			props: { amount: 1029.5, currency: 'USD', cents: true }
		});
		expect(screen.getByRole('img', { name: '$1,029.50' })).toBeInTheDocument();
		expect(cells(container).slice(-3)).toEqual([
			['sep', '.'],
			['cent', '5'],
			['cent', '0']
		]);
		for (const cent of container.querySelectorAll('[data-kind="cent"]')) {
			expect(cent).toHaveClass('bg-bar-on', 'text-bar');
		}
	});

	test('another currency draws its own symbol', () => {
		const { container } = render(Drums, { props: { amount: 42, currency: 'EUR' } });
		expect(cells(container)[0]).toEqual(['sep', '€']);
	});

	test('stays on one line at any width', () => {
		render(Drums, { props: { amount: 123456789, currency: 'USD', size: 'lg' } });
		const drums = screen.getByRole('img');
		for (const name of ['inline-flex', 'flex-nowrap', 'whitespace-nowrap', 'w-max', 'shrink-0']) {
			expect(drums).toHaveClass(name);
		}
	});

	test('the drum shrinks to fit a phone by the number of cells it holds', () => {
		render(Drums, { props: { amount: 1029.5, currency: 'USD', cents: true, size: 'lg' } });
		expect(screen.getByRole('img').getAttribute('style')).toContain('--drum-cells: 8');
	});

	test('an update replaces only the digits that changed', async () => {
		motion.reduce = true;
		const { container, rerender } = render(Drums, { props: { amount: 501, currency: 'USD' } });
		const before = [...container.querySelectorAll('[data-kind] > span')];
		await rerender({ amount: 541, currency: 'USD' });
		const after = [...container.querySelectorAll('[data-kind] > span')];
		expect(after.map(span => span.textContent)).toEqual(['$', '5', '4', '1']);
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe(before[1]);
		expect(after[2]).not.toBe(before[2]);
		expect(after[3]).toBe(before[3]);
	});

	test('with reduced motion the new digit is in place at once', async () => {
		motion.reduce = true;
		const { container, rerender } = render(Drums, { props: { amount: 501, currency: 'USD' } });
		await rerender({ amount: 509, currency: 'USD' });
		const changed = container.querySelectorAll<HTMLElement>('[data-kind] > span')[3]!;
		expect(changed.textContent).toBe('9');
		expect(changed.getAnimations?.() ?? []).toHaveLength(0);
	});

	test('a missing amount shows zero instead of breaking', () => {
		const { container } = render(Drums, { props: { amount: Number.NaN, currency: 'USD' } });
		expect(cells(container)).toEqual([
			['sep', '$'],
			['digit', '0']
		]);
	});
});
