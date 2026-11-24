import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Drums from '../Drums.svelte';

const SOURCE = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'Drums.svelte'),
	'utf8'
);

function cells(container: HTMLElement) {
	return [...container.querySelectorAll<HTMLElement>('[data-kind]')].map(cell => [
		cell.dataset['kind'],
		cell.textContent
	]);
}

function inLocale(locale: string) {
	vi.spyOn(navigator, 'language', 'get').mockReturnValue(locale);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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

	test('in German the euro sign follows the amount and the comma marks the cents', () => {
		inLocale('de-DE');
		const { container } = render(Drums, {
			props: { amount: 1234.5, currency: 'EUR', cents: true }
		});
		expect(cells(container)).toEqual([
			['digit', '1'],
			['digit', '2'],
			['digit', '3'],
			['digit', '4'],
			['sep', ','],
			['cent', '5'],
			['cent', '0'],
			['sep', '€']
		]);
	});

	test('a currency with no minor unit draws no cent cells even when asked', () => {
		const { container } = render(Drums, { props: { amount: 4500, currency: 'JPY', cents: true } });
		expect(cells(container).some(([kind]) => kind === 'cent')).toBe(false);
	});

	test('a negative amount keeps its sign', () => {
		const { container } = render(Drums, { props: { amount: -42, currency: 'USD' } });
		expect(cells(container).map(([, char]) => char)).toEqual(['-$', '4', '2']);
	});

	test('a wide symbol is counted at its width, so the drum still fits', () => {
		const { container } = render(Drums, { props: { amount: 12, currency: 'CHF' } });
		const symbol = container.querySelector<HTMLElement>('[data-kind="sep"]')!;
		expect(symbol.textContent).toBe('CHF');
		expect(symbol.style.width).toBe('1.65em');
		const width = Number(screen.getByRole('img').style.getPropertyValue('--drum-width'));
		expect(width).toBeCloseTo(1.65 + 0.86 * 2 + 0.08 * 2 + 0.3, 5);
	});

	test('stays on one line and shrinks to its container rather than the screen', () => {
		render(Drums, { props: { amount: 123456789, currency: 'USD', size: 'lg' } });
		const drums = screen.getByRole('img');
		for (const name of ['inline-flex', 'flex-nowrap', 'whitespace-nowrap', 'w-max', 'max-w-full']) {
			expect(drums).toHaveClass(name);
		}
		expect(SOURCE).toContain('calc((100cqi - 2.5rem) / var(--drum-width))');
	});

	test('nothing rolls on first paint', () => {
		const { container } = render(Drums, { props: { amount: 501, currency: 'USD' } });
		expect(container.querySelectorAll('[data-roll]')).toHaveLength(0);
	});

	test('an update rolls in only the digits that changed', async () => {
		const { container, rerender } = render(Drums, { props: { amount: 501, currency: 'USD' } });
		const before = [...container.querySelectorAll('[data-kind] > span')];
		await rerender({ amount: 541, currency: 'USD' });
		const after = [...container.querySelectorAll<HTMLElement>('[data-kind] > span')];
		expect(after.map(span => span.textContent)).toEqual(['$', '5', '4', '1']);
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe(before[1]);
		expect(after[2]).not.toBe(before[2]);
		expect(after[3]).toBe(before[3]);
		expect(after.map(span => span.hasAttribute('data-roll'))).toEqual([false, false, true, false]);
	});

	test('the roll is a CSS animation that runs only when motion is allowed', () => {
		const media = SOURCE.indexOf('@media (prefers-reduced-motion: no-preference)');
		const roll = SOURCE.indexOf('animation: drum-roll 300ms');
		expect(media).toBeGreaterThan(-1);
		expect(roll).toBeGreaterThan(media);
		expect(SOURCE).not.toMatch(/\bin:|transition:/);
	});

	test('a missing amount shows zero instead of breaking', () => {
		const { container } = render(Drums, { props: { amount: Number.NaN, currency: 'USD' } });
		expect(cells(container)).toEqual([
			['sep', '$'],
			['digit', '0']
		]);
	});
});
