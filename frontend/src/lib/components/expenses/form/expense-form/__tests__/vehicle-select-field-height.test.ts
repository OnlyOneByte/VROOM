import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import VehicleSelectField from '../VehicleSelectField.svelte';
import { makeVehicle } from './expense-form-fixtures';

describe('VehicleSelectField height', () => {
	test('the select matches the 40px split button', () => {
		const { container } = render(VehicleSelectField, {
			props: {
				vehicles: [makeVehicle('v1'), makeVehicle('v2')],
				value: 'v1',
				canSplit: true,
				onSelect: () => {},
				onSplit: () => {}
			}
		});
		const trigger = container.querySelector('#vehicle') as HTMLElement;
		expect(trigger.classList.contains('data-[size=default]:h-10')).toBe(true);
		expect(trigger.classList.contains('data-[size=default]:h-9')).toBe(false);
		expect(trigger.classList.contains('sm:data-[size=default]:h-10')).toBe(true);
		expect(trigger.classList.contains('sm:data-[size=default]:h-9')).toBe(false);
		const split = container.querySelector('button[aria-label="Split cost across vehicles"]');
		expect(split?.classList.contains('size-10')).toBe(true);
	});
});
