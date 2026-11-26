import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MileageField from '../MileageField.svelte';

function mount(quick: boolean, previousFuelMileage: number | null = 45000) {
	return render(MileageField, {
		required: true,
		previousFuelMileage,
		distanceLabel: 'Miles',
		quick,
		onInput: vi.fn(),
		onBlur: vi.fn()
	});
}

describe('MileageField last reading', () => {
	test('quick add shows "Last time" under the field instead of inside it', () => {
		mount(true);
		expect(screen.getByText('Last time: 45,000')).toBeInTheDocument();
		expect(screen.queryByText('last 45,000')).toBeNull();
		expect(screen.getByLabelText('Odometer *')).toHaveAccessibleDescription(
			'Previous fuel entry: 45,000 miles'
		);
	});

	test('the full form keeps the reading inside the field', () => {
		mount(false);
		expect(screen.getByText('last 45,000')).toBeInTheDocument();
		expect(screen.queryByText(/Last time/)).toBeNull();
	});

	test('with no earlier reading neither form shows one', () => {
		mount(true, null);
		expect(screen.queryByText(/Last time/)).toBeNull();
	});
});
