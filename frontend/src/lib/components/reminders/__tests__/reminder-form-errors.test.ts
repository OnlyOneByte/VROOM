import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { makeVehicle } from '../reminder-form/__tests__/reminder-form-fixtures.ts';

const create = vi.fn();
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: { create: (...args: unknown[]) => create(...args), update: vi.fn() }
}));

const ReminderForm = (await import('../ReminderForm.svelte')).default;

afterEach(() => cleanup());

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

describe('ReminderForm errors', () => {
	test('a missing name is tied to the field and gets the focus', async () => {
		render(ReminderForm, {
			props: { open: true, reminder: null, vehicles: [makeVehicle('v1')], onSaved: vi.fn() }
		});
		const submit = await screen.findByRole('button', { name: 'Create reminder' });
		submit.focus();

		await fireEvent.click(submit);
		await settle();

		const name = screen.getByLabelText('Name *');
		expect(name).toHaveAttribute('aria-invalid', 'true');
		expect(name).toHaveAccessibleDescription('Name is required');
		expect(document.activeElement).toBe(name);
		expect(create).not.toHaveBeenCalled();
	});
});
