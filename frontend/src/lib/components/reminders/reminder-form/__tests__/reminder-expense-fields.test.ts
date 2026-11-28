import { afterEach, describe, expect, test } from 'vitest';
import { tick } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import ReminderExpenseFields from '../ReminderExpenseFields.svelte';
import { ReminderFormState } from '../reminder-form-state.svelte';
import { makeVehicle } from './reminder-form-fixtures.ts';

afterEach(() => cleanup());

describe('ReminderExpenseFields amount', () => {
	test('the amount shows the currency and is described by its error once invalid', async () => {
		const form = new ReminderFormState();
		form.load(null, [makeVehicle('v1')]);
		render(ReminderExpenseFields, { props: { form } });

		const amount = screen.getByLabelText('Amount *');
		expect(amount.parentElement?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe(
			'$'
		);
		expect(amount).toHaveAttribute('aria-invalid', 'false');

		form.errors = { ...form.errors, expenseAmount: 'Enter an amount' };
		await tick();

		expect(amount).toHaveAttribute('aria-invalid', 'true');
		expect(amount).toHaveAccessibleDescription('Enter an amount Currency: US Dollar');
	});
});
