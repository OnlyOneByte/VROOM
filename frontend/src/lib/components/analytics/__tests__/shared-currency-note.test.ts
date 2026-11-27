import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import SharedCurrencyNote from '../SharedCurrencyNote.svelte';

const coverage = (currencies: string[]) => ({
	vehicleIds: ['civic'],
	otherCurrency: currencies.map((currency, i) => ({ vehicleId: `shared-${i}`, currency })),
	unavailable: 0
});

const text = (container: HTMLElement) => container.textContent?.replace(/\s+/g, ' ').trim();

describe('SharedCurrencyNote', () => {
	test('names the figures currency it is given', () => {
		const { container } = render(SharedCurrencyNote, {
			coverage: coverage(['USD']),
			currency: 'EUR'
		});
		expect(text(container)).toBe(
			'Not included: cars shared with you in USD. These figures are in EUR.'
		);
	});

	test('without a currency, names the viewer currency', () => {
		const { container } = render(SharedCurrencyNote, { coverage: coverage(['EUR']) });
		expect(text(container)).toBe(
			'Not included: cars shared with you in EUR. These figures are in USD.'
		);
	});

	test('for figures that are not money, says only which cars were left out', () => {
		const { container } = render(SharedCurrencyNote, {
			coverage: coverage(['EUR', 'GBP']),
			currency: null
		});
		expect(text(container)).toBe('Not included: cars shared with you in EUR and GBP.');
	});

	test('renders nothing without other-currency cars or coverage', () => {
		expect(text(render(SharedCurrencyNote, { coverage: coverage([]) }).container)).toBe('');
		expect(text(render(SharedCurrencyNote, {}).container)).toBe('');
	});
});
