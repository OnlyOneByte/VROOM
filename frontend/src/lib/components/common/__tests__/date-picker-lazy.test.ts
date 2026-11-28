import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const { calendarRequested, showError } = vi.hoisted(() => ({
	calendarRequested: vi.fn(),
	showError: vi.fn()
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { showError } }));

vi.mock('../date-picker-calendar.svelte', async importOriginal => {
	calendarRequested();
	if (calendarRequested.mock.calls.length <= 2) throw new Error('chunk failed to load');
	return importOriginal();
});

const DatePicker = (await import('../date-picker.svelte')).default;

describe('DatePicker calendar loading', () => {
	test('loads the calendar on hover, reports a failed open, and retries on the next open', async () => {
		render(DatePicker, { props: { value: '2026-05-10', id: 'pick' } });
		const trigger = document.getElementById('pick') as Element;
		await Promise.resolve();
		expect(calendarRequested).not.toHaveBeenCalled();

		await fireEvent.pointerEnter(trigger);
		await vi.waitFor(() => expect(calendarRequested).toHaveBeenCalledTimes(1));
		expect(showError).not.toHaveBeenCalled();

		await fireEvent.click(trigger);
		await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce());
		expect(showError.mock.calls[0]?.[0]).toMatch(/^Couldn't open the calendar\./);
		await vi.waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
		expect(screen.queryByRole('grid')).toBeNull();

		await fireEvent.click(trigger);
		expect(await screen.findByRole('grid')).toBeInTheDocument();
		expect(calendarRequested).toHaveBeenCalledTimes(3);
	});
});
