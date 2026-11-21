import { afterEach, describe, expect, test } from 'vitest';
import { tick } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import ReminderVehicleFields from '../ReminderVehicleFields.svelte';
import { ReminderFormState } from '../reminder-form-state.svelte';
import { makeVehicle } from './reminder-form-fixtures.ts';

afterEach(() => cleanup());

function mount() {
	const vehicles = [makeVehicle('v1'), makeVehicle('v2')];
	const form = new ReminderFormState();
	form.load(null, vehicles);
	render(ReminderVehicleFields, { props: { form, vehicles } });
	return form;
}

describe('ReminderVehicleFields', () => {
	test('the checklist is a group named by its label', () => {
		mount();
		const group = screen.getByRole('group', { name: 'Vehicles *' });
		expect(group.getAttribute('aria-describedby')).toBeNull();
		for (const box of screen.getAllByRole('checkbox')) {
			expect(box.getAttribute('aria-invalid')).toBe('false');
		}
	});

	test('an empty selection marks each vehicle invalid and describes the group by the error', async () => {
		const form = mount();
		form.validate();
		await tick();
		const group = screen.getByRole('group', { name: 'Vehicles *' });
		expect(group).toHaveAccessibleDescription('Select at least one vehicle');
		for (const box of screen.getAllByRole('checkbox')) {
			expect(box.getAttribute('aria-invalid')).toBe('true');
		}
	});
});
