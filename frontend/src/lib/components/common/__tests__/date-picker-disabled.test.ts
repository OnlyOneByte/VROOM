import { describe, expect, test, vi } from 'vitest';
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

describe('DatePicker id', () => {
	test('the trigger button carries the id the caller passed', () => {
		render(DatePicker, { props: { value: '2026-05-10', id: 'trip-date' } });
		expect(document.getElementById('trip-date')).toBe(
			screen.getByRole('button', { name: /May 10, 2026/ })
		);
	});

	test('a labelled picker still announces its date, ahead of any error', () => {
		render(DatePicker, {
			props: { value: '2026-05-10', id: 'trip-date', 'aria-describedby': 'trip-date-error' }
		});
		const trigger = document.getElementById('trip-date');
		expect(trigger?.getAttribute('aria-describedby')).toBe('trip-date-value trip-date-error');
		expect(document.getElementById('trip-date-value')?.textContent).toBe('May 10, 2026');
	});
});

describe('DatePicker opening focus', () => {
	test('opening the calendar focuses the selected day, not Previous month', async () => {
		render(DatePicker, { props: { value: '2026-05-10' } });

		await fireEvent.click(screen.getByRole('button', { name: /May 10, 2026/ }));
		await screen.findByRole('grid');

		await vi.waitFor(() =>
			expect(document.activeElement?.getAttribute('data-value')).toBe('2026-05-10')
		);
		expect(document.activeElement).toHaveAttribute('data-bits-day');
	});

	test('Enter on the focused selected day keeps the date and closes the calendar', async () => {
		render(DatePicker, { props: { value: '2026-05-10', id: 'pick' } });
		await fireEvent.click(screen.getByRole('button', { name: /May 10, 2026/ }));
		await screen.findByRole('grid');
		await vi.waitFor(() =>
			expect(document.activeElement?.getAttribute('data-value')).toBe('2026-05-10')
		);

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });

		expect(document.getElementById('pick')).toHaveTextContent('May 10, 2026');
		await vi.waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
	});

	test('clicking the selected day still clears an optional date', async () => {
		render(DatePicker, { props: { value: '2026-05-10', id: 'pick', placeholder: 'No end date' } });
		await fireEvent.click(document.getElementById('pick') as Element);
		await screen.findByRole('grid');

		await fireEvent.click(document.querySelector('[data-bits-day][data-selected]') as Element);

		expect(document.getElementById('pick')).toHaveTextContent('No end date');
	});

	test('a selected day in the current month wins over today', async () => {
		const now = new Date();
		const day = now.getDate() === 1 ? 2 : now.getDate() - 1;
		const value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		render(DatePicker, { props: { value, id: 'pick' } });

		await fireEvent.click(document.getElementById('pick') as Element);
		await screen.findByRole('grid');

		await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-value')).toBe(value));
		expect(document.activeElement).not.toHaveAttribute('data-today');
	});

	test('with no date set, opening focuses today', async () => {
		render(DatePicker, { props: { value: undefined, placeholder: 'Pick a date' } });

		await fireEvent.click(screen.getByRole('button', { name: /Pick a date/ }));
		await screen.findByRole('grid');

		await vi.waitFor(() => expect(document.activeElement).toHaveAttribute('data-today'));
	});
});
