import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { OdometerEntry, PaginatedResponse } from '#lib/types/index.ts';
import type { odometerApi } from '#lib/services/odometer-api.ts';
import { ApiError, UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

type CreateOdometerRequest = Parameters<typeof odometerApi.create>[1];

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/common/date-picker.svelte', async () => ({
	default: (await import('../../__tests__/DatePickerStub.svelte')).default
}));

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/vehicles/v1/odometer/new') }));
vi.mock('$app/state', () => ({ page: pageState }));

const pendingPhotoProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('#lib/components/expenses/form/PendingPhotoPreview.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		pendingPhotoProps.current = props;
	}
}));

const getEntries =
	vi.fn<
		(
			vehicleId: string,
			params: { limit: number; offset: number }
		) => Promise<PaginatedResponse<OdometerEntry>>
	>();
const create = vi.fn<(vehicleId: string, data: CreateOdometerRequest) => Promise<OdometerEntry>>();

vi.mock('#lib/services/odometer-api.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/services/odometer-api.ts')>()),
	odometerApi: {
		getEntries: (vehicleId: string, params: { limit: number; offset: number }) =>
			getEntries(vehicleId, params),
		create: (vehicleId: string, data: CreateOdometerRequest) => create(vehicleId, data),
		uploadPhoto: vi.fn()
	}
}));

import Page from '../+page.svelte';

const TODAY = new Date(2026, 10, 21, 9, 0, 0);
const LATEST_NOTE = /^Your latest reading is [\d,]+\.$/;

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
	test('the photo picker names a reading, not an expense', async () => {
		mount();
		await settle();

		expect(pendingPhotoProps.current?.['entityNoun']).toBe('reading');
	});

	test('the date defaults to today and the note counter starts at zero', async () => {
		mount();
		await settle();

		expect(dateInput().value).toBe('2026-11-21');
		expect(odometerInput()).toHaveAttribute('inputmode', 'numeric');
		expect(screen.getByText('0/500')).toBeInTheDocument();
		expect(getEntries).toHaveBeenCalledWith('v1', { limit: 1, offset: 0 });
		for (const name of ['Cancel', 'Save Reading']) {
			expect(screen.getByRole('button', { name })).toHaveClass('h-10');
		}
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

	test('the latest-reading status region exists before the note and announces a fixed message', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		const region = screen.getByRole('status');
		expect(region).toBeEmptyDOMElement();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		expect(region).toHaveTextContent('Your latest reading is 50,000.');

		await fireEvent.input(odometerInput(), { target: { value: '48000' } });
		expect(screen.getByRole('status')).toBe(region);
		expect(region).toHaveTextContent('Your latest reading is 50,000.');
		expect(region).not.toHaveTextContent('Are you sure');
	});

	test('a failed check moves focus to the first invalid field', async () => {
		mount();
		await settle();

		await fireEvent.input(dateInput(), { target: { value: '' } });
		await save();

		expect(document.activeElement).toBe(odometerInput());
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

	test('a cleared reading does not show the latest reading', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		expect(screen.queryByText(LATEST_NOTE)).not.toBeNull();

		await fireEvent.input(odometerInput(), { target: { value: '' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
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

describe('new odometer reading latest-reading note', () => {
	test('shows the latest reading for a reading at or below it on a later date', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		expect(screen.getByText(LATEST_NOTE)).toHaveTextContent('Your latest reading is 50,000.');

		await fireEvent.input(odometerInput(), { target: { value: '50000' } });
		expect(screen.queryByText(LATEST_NOTE)).not.toBeNull();
	});

	test('no note for a reading above the latest', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '51000' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
	});

	test('no note for a backdated reading before the latest one', async () => {
		getEntries.mockResolvedValue(
			latest([entry({ odometer: 50000, recordedAt: new Date(2026, 10, 1, 12).toISOString() })])
		);
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '40000' } });
		await fireEvent.input(dateInput(), { target: { value: '2026-10-15' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();

		await fireEvent.input(dateInput(), { target: { value: '2026-11-01' } });
		expect(screen.queryByText(LATEST_NOTE)).not.toBeNull();
	});

	test('no note when the vehicle has no prior readings', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '10' } });

		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
	});

	test('a failed latest-reading lookup is ignored and the form still saves', async () => {
		getEntries.mockRejectedValue(new Error('offline'));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '10' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
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

		const error = screen.getByText("Couldn't save the reading. Reading must not decrease.");
		expect(error).toHaveAttribute('role', 'alert');
		expect(document.activeElement).toBe(error);
		expect(goto).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Save Reading' })).toBeEnabled();
	});

	test('an out-of-order refusal is shown on the odometer field and focuses it', async () => {
		getEntries.mockResolvedValue(latest([entry({ odometer: 50000 })]));
		create.mockRejectedValue(
			new ApiError('Mileage must be greater than 50,000 (from earlier entry)', 400)
		);
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '49000' } });
		await save();

		const input = odometerInput();
		expect(input).toHaveAttribute('aria-invalid', 'true');
		const error = document.getElementById(input.getAttribute('aria-describedby') as string);
		expect(error).toHaveTextContent('Mileage must be greater than 50,000 (from earlier entry).');
		expect(error).toHaveAttribute('role', 'alert');
		expect(document.activeElement).toBe(input);
		expect(screen.queryByText(/Couldn't save the reading/)).toBeNull();
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
	});

	test('another 400 stays a form-level error', async () => {
		create.mockRejectedValue(new ApiError('Date cannot be in the future', 400));
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(odometerInput()).toHaveAttribute('aria-invalid', 'false');
		expect(
			screen.getByText("Couldn't save the reading. Date cannot be in the future.")
		).toHaveAttribute('role', 'alert');
	});

	test('a non-Error failure shows the generic save message', async () => {
		create.mockRejectedValue('boom');
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });
		await save();

		expect(
			screen.getByText(`Couldn't save the reading. ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
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
