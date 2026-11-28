import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import AnalyticsFilterBar from '../AnalyticsFilterBar.svelte';

const vehicles = [
	{ id: 'civic', name: 'Civic' },
	{ id: 'rav4', name: 'RAV4' }
];

describe('AnalyticsFilterBar', () => {
	test('shows Range and Cars by default', () => {
		render(AnalyticsFilterBar, {
			props: { filters: { range: '12m', cars: [] }, vehicles, onChange: vi.fn() }
		});
		expect(screen.getByRole('button', { name: /^Range/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Cars/ })).toBeTruthy();
	});

	test('without Range, a changed range is not offered for clearing', () => {
		render(AnalyticsFilterBar, {
			props: { filters: { range: '3m', cars: [] }, vehicles, onChange: vi.fn(), showRange: false }
		});
		expect(screen.queryByRole('button', { name: /^Range/ })).toBeNull();
		expect(screen.getByRole('button', { name: /^Cars/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull();
	});

	test('without Range, "Clear cars" resets the cars and keeps the range', async () => {
		const onChange = vi.fn();
		render(AnalyticsFilterBar, {
			props: { filters: { range: '3m', cars: ['civic'] }, vehicles, onChange, showRange: false }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Clear cars' }));
		expect(onChange).toHaveBeenCalledWith({ range: '3m', cars: [] });
	});
});
