import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import VehicleSelectField from '../VehicleSelectField.svelte';
import { makeVehicle } from './expense-form-fixtures';

function trigger(container: HTMLElement) {
	return container.querySelector('#vehicle') as HTMLElement;
}

const base = {
	vehicles: [makeVehicle('v1')],
	value: 'v1',
	canSplit: false,
	onSelect: () => {},
	onSplit: () => {}
};

describe('VehicleSelectField description', () => {
	test('links an extra description to the vehicle select', () => {
		const { container } = render(VehicleSelectField, {
			props: { ...base, describedBy: 'fuel-split-hint' }
		});
		expect(trigger(container).getAttribute('aria-describedby')).toBe('fuel-split-hint');
	});

	test('keeps the error id alongside the description', () => {
		const { container } = render(VehicleSelectField, {
			props: { ...base, describedBy: 'fuel-split-hint', error: 'Pick a vehicle' }
		});
		expect(trigger(container).getAttribute('aria-describedby')).toBe(
			'vehicleId-error fuel-split-hint'
		);
	});

	test('has no description when there is none', () => {
		const { container } = render(VehicleSelectField, { props: base });
		expect(trigger(container).hasAttribute('aria-describedby')).toBe(false);
	});
});
