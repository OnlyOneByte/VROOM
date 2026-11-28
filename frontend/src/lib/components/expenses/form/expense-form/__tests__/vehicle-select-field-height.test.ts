import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import VehicleSelectField from '../VehicleSelectField.svelte';
import { makeVehicle } from './expense-form-fixtures';

describe('VehicleSelectField height', () => {
	test('the vehicle chip matches the labelled split button: 40px at every width', () => {
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
		expect([...trigger.classList].some(c => c.startsWith('sm:data-[size=default]:h-'))).toBe(false);
		const split = container.querySelector('button[aria-label="Split cost across vehicles"]');
		expect(split?.classList.contains('h-10')).toBe(true);
		expect(split?.textContent?.trim()).toBe('Split');
		expect([...(split?.classList ?? [])].some(c => c.startsWith('sm:h-'))).toBe(false);
	});
});
