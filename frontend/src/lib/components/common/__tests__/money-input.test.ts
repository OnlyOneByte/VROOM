import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';
import MoneyInput from '../MoneyInput.svelte';

afterEach(cleanup);

function box(currency: string, value?: number) {
	render(MoneyInput, { props: { id: 'price', currency, value } });
	const input = document.getElementById('price') as HTMLInputElement;
	const symbol = input.parentElement?.querySelector('[aria-hidden="true"]');
	return { input, symbol };
}

describe('MoneyInput', () => {
	test.each([
		['USD', '$', 1],
		['CAD', 'CA$', 3],
		['CHF', 'CHF', 3],
		['JPY', '¥', 1]
	])('a %s amount shows %s in the box and leaves room for it', (currency, text, length) => {
		const { input, symbol } = box(currency);
		expect(symbol?.textContent?.trim()).toBe(text);
		expect(input.style.paddingLeft).toBe(`calc(1.125rem + ${length}ch)`);
	});

	test('a screen reader hears the currency by name, alongside any error', () => {
		render(MoneyInput, {
			props: { id: 'price', currency: 'CHF', 'aria-describedby': 'price-error' }
		});
		const input = screen.getByRole('spinbutton');
		expect(input).toHaveAttribute('aria-describedby', 'price-error price-currency');
		expect(document.getElementById('price-currency')).toHaveTextContent('Currency: Swiss Franc');
	});

	test('the symbol is muted while the box is empty, and plain once there is an amount', () => {
		expect(box('USD').symbol).toHaveClass('text-muted-foreground');
		cleanup();
		expect(box('USD', 25).symbol).toHaveClass('text-foreground');
	});

	test('it steps in the currency’s smallest unit and has no placeholder figure', () => {
		expect(box('JPY').input).toHaveAttribute('step', '1');
		cleanup();
		const { input } = box('USD');
		expect(input).toHaveAttribute('step', '0.01');
		expect(input).toHaveAttribute('inputmode', 'decimal');
		expect(input).not.toHaveAttribute('placeholder');
	});
});
