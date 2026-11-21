import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { OdometerEntry, PaginatedResponse } from '#lib/types/index.ts';
import type { odometerApi } from '#lib/services/odometer-api.ts';

type CreateOdometerRequest = Parameters<typeof odometerApi.create>[1];

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/vehicles/v1/odometer/new') }));
vi.mock('$app/state', () => ({ page: pageState }));

vi.mock('#lib/components/expenses/form/PendingPhotoPreview.svelte', () => ({ default: () => {} }));

const getEntries =
	vi.fn<
		(
			vehicleId: string,
			params: { limit: number; offset: number }
		) => Promise<PaginatedResponse<OdometerEntry>>
	>();
const create = vi.fn<(vehicleId: string, data: CreateOdometerRequest) => Promise<OdometerEntry>>();

vi.mock('#lib/services/odometer-api.ts', () => ({
	odometerApi: {
		getEntries: (vehicleId: string, params: { limit: number; offset: number }) =>
			getEntries(vehicleId, params),
		create: (vehicleId: string, data: CreateOdometerRequest) => create(vehicleId, data),
		uploadPhoto: vi.fn()
	}
}));

import Page from '../+page.svelte';

const TODAY = new Date(2026, 10, 21, 9, 0, 0);

function entry(overrides: Partial<OdometerEntry> = {}): OdometerEntry {
	return {
		id: 'o1',
		vehicleId: 'v1',
		odometer: 50000,
		recordedAt: '2026-11-01T12:00:00.000Z',
		createdAt: '2026-11-01T12:00:00.000Z',
		updatedAt: '2026-11-01T12:00:00.000Z',
		...overrides
	};
}

function latest(entries: OdometerEntry[]): PaginatedResponse<OdometerEntry> {
	return {
		data: entries,
		pagination: { totalCount: entries.length, limit: 1, offset: 0, hasMore: false }
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

function mount() {
	return render(Page, { props: { data: { vehicleId: 'v1' } } as never });
}

function odometerInput(): HTMLInputElement {
	return screen.getByLabelText('Odometer Reading *') as HTMLInputElement;
}

function dateInput(): HTMLInputElement {
	return screen.getByLabelText('Date *') as HTMLInputElement;
}

function noteInput(): HTMLTextAreaElement {
	return screen.getByLabelText('Note (Optional)') as HTMLTextAreaElement;
}

async function save(): Promise<void> {
	await fireEvent.click(screen.getByRole('button', { name: 'Save Reading' }));
	await settle();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(TODAY);
	vi.clearAllMocks();
	pageState.url = new URL('http://localhost/vehicles/v1/odometer/new');
	getEntries.mockResolvedValue(latest([]));
	create.mockResolvedValue(entry({ id: 'new' }));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('new odometer reading page defaults', () => {
	test('the date defaults to today and the note counter starts at zero', async () => {
		mount();
		await settle();

		expect(dateInput().value).toBe('2026-11-21');
		expect(screen.getByText('0/500')).toBeInTheDocument();
		expect(getEntries).toHaveBeenCalledWith('v1', { limit: 1, offset: 0 });
	});

	test('the note counter tracks the typed length', async () => {
		mount();
		await settle();

		await fireEvent.input(noteInput(), { target: { value: 'Oil change' } });

		expect(screen.getByText('10/500')).toBeInTheDocument();
	});
});

describe('new odometer reading validation', () => {
	test('a field error is announced and linked to its input', async () => {
		mount();
		await settle();

		expect(odometerInput()).toHaveAttribute('aria-invalid', 'false');
		await save();

		const input = odometerInput();
		expect(input).toHaveAttribute('aria-invalid', 'true');
		const describedBy = input.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		const error = document.getElementById(describedBy as string);
		expect(error).toHaveTextContent('Odometer reading is required');
		expect(error).toHaveAttribute('role', 'alert');
	});

	test('a cleared date error is linked to the date input', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await fireEvent.input(dateInput(), { target: { value: '' } });
		await save();

		const describedBy = dateInput().getAttribute('aria-describedby');
		expect(document.getElementById(describedBy as string)).toHaveTextContent('Date is required');
		expect(odometerInput()).not.toHaveAttribute('aria-describedby');
	});

	test('the warning status region exists before the warning and announces a fixed message', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		const region = screen.getByRole('status');
		expect(region).toBeEmptyDOMElement();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		const announced = region.querySelector('.sr-only');
		expect(announced).toHaveTextContent(
			'This reading is lower than the latest recorded value of 50,000. Are you sure?'
		);

		await fireEvent.input(odometerInput(), { target: { value: '48000' } });
		expect(screen.getByRole('status')).toBe(region);
		expect(region.querySelector('.sr-only')).toHaveTextContent(
			'This reading is lower than the latest recorded value of 50,000. Are you sure?'
		);
	});

	test('editing a field clears its error and its aria wiring', async () => {
		mount();
		await settle();

		await save();
		expect(odometerInput()).toHaveAttribute('aria-invalid', 'true');

		await fireEvent.input(odometerInput(), { target: { value: '100' } });

		expect(odometerInput()).toHaveAttribute('aria-invalid', 'false');
		expect(odometerInput()).not.toHaveAttribute('aria-describedby');
		expect(screen.queryByText('Odometer reading is required')).toBeNull();
	});

	test('editing one field leaves the other field errors in place', async () => {
		mount();
		await settle();

		await fireEvent.input(dateInput(), { target: { value: '' } });
		await save();
		expect(screen.getByText('Odometer reading is required')).toBeInTheDocument();
		expect(screen.getByText('Date is required')).toBeInTheDocument();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });

		expect(screen.queryByText('Odometer reading is required')).toBeNull();
		expect(screen.getByText('Date is required')).toBeInTheDocument();
	});

	test('an empty reading is required and nothing is saved', async () => {
		mount();
		await settle();

		await save();

		expect(screen.getByText('Odometer reading is required')).toBeInTheDocument();
		expect(odometerInput()).toHaveClass('border-destructive');
		expect(create).not.toHaveBeenCalled();
	});

	test('a reading typed and then cleared is required instead of being saved as 0', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await fireEvent.input(odometerInput(), { target: { value: '' } });
		await save();

		expect(screen.getByText('Odometer reading is required')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('a cleared reading does not warn that it is lower than the latest', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		expect(
			screen.queryByText(/reading \([\d,]+\) is lower than the latest recorded/)
		).not.toBeNull();

		await fireEvent.input(odometerInput(), { target: { value: '' } });
		expect(screen.queryByText(/reading \([\d,]+\) is lower than the latest recorded/)).toBeNull();
	});

	test('a negative reading is rejected', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '-5' } });
		await save();

		expect(screen.getByText('Odometer must be 0 or greater')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('the browser blocks submitting a fractional reading through the Save button', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100.5' } });
		await save();

		expect(odometerInput().validity.stepMismatch).toBe(true);
		expect(create).not.toHaveBeenCalled();
	});

	test('a fractional reading that reaches validation is rejected as not whole', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100.5' } });
		await fireEvent.submit(odometerInput().closest('form') as HTMLFormElement);
		await settle();

		expect(screen.getByText('Odometer must be a whole number')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('a cleared date is required', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await fireEvent.input(dateInput(), { target: { value: '' } });
		await save();

		expect(screen.getByText('Date is required')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('a note over 500 characters is rejected', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await fireEvent.input(noteInput(), { target: { value: 'x'.repeat(501) } });
		await save();

		expect(screen.getByText('Note must be 500 characters or less')).toBeInTheDocument();
		expect(create).not.toHaveBeenCalled();
	});

	test('fixing an error clears it on the next save', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '-5' } });
		await save();
		await fireEvent.input(odometerInput(), { target: { value: '5' } });
		await save();

		expect(screen.queryByText('Odometer must be 0 or greater')).toBeNull();
		expect(create).toHaveBeenCalledTimes(1);
	});
});

describe('new odometer reading lower-than-latest warning', () => {
	test('warns when the reading is below the latest recorded value', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });

		expect(
			screen.getByText(/reading \([\d,]+\) is lower than the latest recorded/)
		).toHaveTextContent(
			'This reading (49,000) is lower than the latest recorded value (50,000). Are you sure?'
		);
	});

	test('no warning for a reading equal to or above the latest', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '50000' } });
		expect(screen.queryByText(/reading \([\d,]+\) is lower than the latest recorded/)).toBeNull();

		await fireEvent.input(odometerInput(), { target: { value: '51000' } });
		expect(screen.queryByText(/reading \([\d,]+\) is lower than the latest recorded/)).toBeNull();
	});

	test('no warning when the vehicle has no prior readings', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '10' } });

		expect(screen.queryByText(/reading \([\d,]+\) is lower than the latest recorded/)).toBeNull();
	});

	test('a failed latest-reading lookup is ignored and the form still saves', async () => {
		getEntries.mockRejectedValue(new Error('offline'));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '10' } });
		expect(screen.queryByText(/reading \([\d,]+\) is lower than the latest recorded/)).toBeNull();
		await save();

		expect(create).toHaveBeenCalled();
	});

	test('a below-latest reading can still be saved', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		await save();

		expect(create).toHaveBeenCalledWith('v1', expect.objectContaining({ odometer: 49000 }));
	});
});

describe('new odometer reading submit', () => {
	test('saves the reading at local noon of the picked day and returns to the vehicle', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '45210' } });
		await fireEvent.input(dateInput(), { target: { value: '2026-11-10' } });
		await fireEvent.input(noteInput(), { target: { value: 'Oil change visit' } });
		await save();

		expect(create).toHaveBeenCalledWith('v1', {
			odometer: 45210,
			recordedAt: new Date(2026, 10, 10, 12, 0, 0).toISOString(),
			note: 'Oil change visit'
		});
		expect(goto).toHaveBeenCalledWith('/vehicles/v1');
	});

	test('an empty note is sent as undefined', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(create.mock.calls[0]?.[1].note).toBeUndefined();
	});

	test('a returnTo query parameter decides where to go after saving', async () => {
		pageState.url = new URL('http://localhost/vehicles/v1/odometer/new?returnTo=/trips');
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(goto).toHaveBeenCalledWith('/trips');
	});

	test('a failed save shows the server message and stays on the page', async () => {
		create.mockRejectedValue(new Error('Reading must not decrease'));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(screen.getByText('Reading must not decrease')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Save Reading' })).toBeEnabled();
	});

	test('a non-Error failure shows the generic save message', async () => {
		create.mockRejectedValue('boom');
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(screen.getByText('Failed to save odometer reading')).toBeInTheDocument();
	});

	test('Save is disabled while the reading is being saved', async () => {
		create.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(screen.getByRole('button', { name: 'Save Reading' })).toBeDisabled();
	});
});

describe('new odometer reading navigation', () => {
	test('Cancel returns without saving', async () => {
		mount();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(goto).toHaveBeenCalledWith('/vehicles/v1');
		expect(create).not.toHaveBeenCalled();
	});

	test('Back returns to the returnTo target', async () => {
		pageState.url = new URL('http://localhost/vehicles/v1/odometer/new?returnTo=/dashboard');
		mount();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));

		expect(goto).toHaveBeenCalledWith('/dashboard');
	});

	test('a save in flight counts as unsaved changes', async () => {
		create.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();
		await fireEvent.input(odometerInput(), { target: { value: '12345' } });

		await save();

		expect(hasPendingSave()).toBe(true);
	});
});
