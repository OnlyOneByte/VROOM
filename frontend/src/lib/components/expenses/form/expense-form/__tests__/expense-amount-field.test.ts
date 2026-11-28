import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ExpenseAmountField from '../ExpenseAmountField.svelte';

afterEach(() => cleanup());

describe('ExpenseAmountField on Quick Add', () => {
	test('the empty figure shows 0.00 in a faint tone, so it does not read as an amount', () => {
		render(ExpenseAmountField, {
			props: { amount: '', quick: true, onAmountBlur: () => {}, currency: 'USD' }
		});
		const input = screen.getByLabelText('Amount *');
		expect(input).toHaveAttribute('placeholder', '0.00');
		expect(input).toHaveClass('placeholder:text-muted-foreground/40');
		expect(input.parentElement?.querySelector('[aria-hidden="true"]')).toHaveClass(
			'text-muted-foreground/40'
		);
		expect(input).not.toHaveClass('placeholder:text-muted-foreground');
	});
});
