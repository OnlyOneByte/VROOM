import { afterEach, describe, expect, test } from 'vitest';
import { tick } from 'svelte';
import { cleanup, render, screen } from '@testing-library/svelte';
import ReminderVehicleFields from '../ReminderVehicleFields.svelte';
import { ReminderFormState } from '../reminder-form-state.svelte';
import { makeVehicle } from './reminder-form-fixtures.ts';
import { focusFirstProblem } from '#lib/utils/focus.ts';

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

	test('a split error describes the split group, which then takes the focus', async () => {
		const vehicles = [makeVehicle('v1'), makeVehicle('v2')];
		const form = new ReminderFormState();
		form.load(null, vehicles);
		form.values.kind = 'expense';
		form.values.expenseAmount = '10';
		form.toggleVehicle('v1');
		form.toggleVehicle('v2');
		const { container } = render(ReminderVehicleFields, { props: { form, vehicles } });
		form.errors = { split: 'Percentages must add up to 100%' };
		await tick();

		const group = screen.getByRole('group', { name: 'Split across vehicles' });
		expect(group).toHaveAccessibleDescription('Percentages must add up to 100%');
		await focusFirstProblem(container);
		expect(document.activeElement).toBe(group);
	});

	test('the even split preview lists vehicles in the order they were ticked, as the saved split does', async () => {
		const vehicles = [
			makeVehicle('v1', { nickname: 'First' }),
			makeVehicle('v2', { nickname: 'Second' })
		];
		const form = new ReminderFormState();
		form.load(null, vehicles);
		form.values.kind = 'expense';
		form.values.expenseAmount = '10.01';
		form.toggleVehicle('v2');
		form.toggleVehicle('v1');
		render(ReminderVehicleFields, { props: { form, vehicles } });
		await tick();

		const rowText = (name: string) =>
			screen.getAllByText(name).at(-1)?.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
		expect(rowText('Second')).toBe('Second $5.01');
		expect(rowText('First')).toBe('First $5.00');
	});
});
