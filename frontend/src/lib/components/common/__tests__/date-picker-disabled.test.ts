import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DatePicker from '../date-picker.svelte';

describe('DatePicker disabled state', () => {
	test('a disabled picker renders a disabled trigger that does not open the calendar', async () => {
		render(DatePicker, { props: { value: '2026-05-10', disabled: true } });

		const trigger = screen.getByRole('button', { name: /May 10, 2026/ });
		expect(trigger).toBeDisabled();

		await fireEvent.click(trigger);
		expect(screen.queryByRole('grid')).toBeNull();
	});

	test('an enabled picker opens the calendar', async () => {
		render(DatePicker, { props: { value: '2026-05-10' } });

		const trigger = screen.getByRole('button', { name: /May 10, 2026/ });
		expect(trigger).toBeEnabled();

		await fireEvent.click(trigger);
		expect(await screen.findByRole('grid')).toBeInTheDocument();
	});
});
