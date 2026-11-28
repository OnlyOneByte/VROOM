import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import {
	makeReminderWithVehicles,
	makeVehicle
} from '../reminder-form/__tests__/reminder-form-fixtures.ts';

const update = vi.fn<(id: string, payload: unknown) => Promise<unknown>>();
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		create: vi.fn(),
		update: (id: string, payload: unknown) => update(id, payload)
	}
}));

const ReminderForm = (await import('../ReminderForm.svelte')).default;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('ReminderForm save registration', () => {
	test('a save in flight counts as unsaved changes until the form closes', async () => {
		update.mockReturnValue(new Promise(() => {}));
		const { unmount } = render(ReminderForm, {
			props: {
				open: true,
				reminder: makeReminderWithVehicles(),
				vehicles: [makeVehicle('v1')],
				onSaved: vi.fn()
			}
		});
		expect(hasPendingSave()).toBe(false);

		await fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));

		expect(update).toHaveBeenCalled();
		expect(hasPendingSave()).toBe(true);
		unmount();
		expect(hasPendingSave()).toBe(false);
	});
});
