import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { signInAsDemo } from '../../../../../../../test-utils/demo-user';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { OdometerEntry, PaginatedResponse, Photo } from '#lib/types/index.ts';
import type { odometerApi } from '#lib/services/odometer-api.ts';
import { ApiError, NetworkError, UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

type UpdateOdometerRequest = Parameters<typeof odometerApi.update>[1];

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/common/date-picker.svelte', async () => ({
	default: (await import('../../../__tests__/DatePickerStub.svelte')).default
}));

const pageState = vi.hoisted(() => ({
	url: new URL('http://localhost/vehicles/v1/odometer/o1/edit')
}));
vi.mock('$app/state', () => ({ page: pageState }));

const getEntry = vi.fn<(entryId: string) => Promise<OdometerEntry | null>>();
const getEntries =
	vi.fn<
		(
			vehicleId: string,
			params: { limit: number; offset: number }
		) => Promise<PaginatedResponse<OdometerEntry>>
	>();
const update = vi.fn<(entryId: string, data: UpdateOdometerRequest) => Promise<OdometerEntry>>();
const deleteEntry = vi.fn<(entryId: string) => Promise<void>>();

vi.mock('#lib/services/odometer-api.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/services/odometer-api.ts')>()),
	odometerApi: {
		getEntry: (entryId: string) => getEntry(entryId),
		getEntries: (vehicleId: string, params: { limit: number; offset: number }) =>
			getEntries(vehicleId, params),
		update: (entryId: string, data: UpdateOdometerRequest) => update(entryId, data),
		delete: (entryId: string) => deleteEntry(entryId)
	}
}));

const photoMocks = vi.hoisted(() => ({
	getPhotos: vi.fn<(entityType: string, entityId: string) => Promise<PaginatedResponse<Photo>>>(),
	deletePhoto: vi.fn<(entityType: string, entityId: string, photoId: string) => Promise<void>>()
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getPhotos: photoMocks.getPhotos,
		deletePhoto: photoMocks.deletePhoto,
		uploadPhoto: vi.fn(),
		getPhotoThumbnailUrl: (entityType: string, entityId: string, photoId: string) =>
			`/thumbs/${entityType}/${entityId}/${photoId}`
	}
}));

import Page from '../+page.svelte';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';

const LATEST_NOTE = /^Your latest reading is [\d,]+\.$/;

function entry(overrides: Partial<OdometerEntry> = {}): OdometerEntry {
	return {
		id: 'o1',
		vehicleId: 'v1',
		odometer: 45000,
		recordedAt: new Date(2026, 2, 15, 12, 0, 0).toISOString(),
		note: 'Oil change visit',
		createdAt: '2026-03-15T12:00:00.000Z',
		updatedAt: '2026-03-15T12:00:00.000Z',
		...overrides
	};
}

function photo(id: string): Photo {
	return {
		id,
		entityType: 'odometer_entry',
		entityId: 'o1',
		fileName: `${id}.jpg`,
		mimeType: 'image/jpeg',
		fileSize: 1024,
		isCover: false,
		sortOrder: 0,
		createdAt: '2026-03-15T12:00:00.000Z'
	};
}

function photoPage(data: Photo[]): PaginatedResponse<Photo> {
	return { data, pagination: { totalCount: data.length, limit: 50, offset: 0, hasMore: false } };
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
	return render(Page, { props: { data: { vehicleId: 'v1', entryId: 'o1' } } as never });
}

function odometerInput(): HTMLInputElement {
	return screen.getByLabelText('Odometer reading') as HTMLInputElement;
}

function dateInput(): HTMLInputElement {
	return screen.getByLabelText('Date') as HTMLInputElement;
}

function noteInput(): HTMLTextAreaElement {
	return screen.getByLabelText('Note (optional)') as HTMLTextAreaElement;
}

async function save(): Promise<void> {
	await fireEvent.click(screen.getByRole('button', { name: 'Save reading' }));
	await settle();
}

async function openDeleteDialog(): Promise<HTMLElement> {
	await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
	await settle();
	return screen.getByRole('dialog');
}

beforeEach(() => {
	vi.clearAllMocks();
	pageState.url = new URL('http://localhost/vehicles/v1/odometer/o1/edit');
	getEntry.mockResolvedValue(entry());
	getEntries.mockResolvedValue(latest([entry()]));
	update.mockResolvedValue(entry());
	deleteEntry.mockResolvedValue();
	photoMocks.getPhotos.mockResolvedValue(photoPage([]));
	photoMocks.deletePhoto.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('edit odometer reading load states', () => {
	test('shows a spinner and no form while the entry loads', async () => {
		getEntry.mockReturnValue(new Promise(() => {}));
		const { container } = mount();
		await settle();

		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByLabelText('Odometer Reading')).toBeNull();
		expect(getEntry).toHaveBeenCalledWith('o1');
		expect(getEntries).toHaveBeenCalledWith('v1', { limit: 1, offset: 0 });
	});

	test('prefills the form from the stored entry', async () => {
		mount();
		await settle();

		expect(odometerInput().value).toBe('45000');
		expect(dateInput().value).toBe('2026-03-15');
		expect(noteInput().value).toBe('Oil change visit');
		expect(odometerInput()).toHaveAttribute('inputmode', 'numeric');
		expect(screen.getByText('16/500')).toBeInTheDocument();
	});

	test('an entry without a note prefills an empty note', async () => {
		getEntry.mockResolvedValue(entry({ note: undefined }));
		mount();
		await settle();

		expect(noteInput().value).toBe('');
	});

	test('a missing entry shows not-found instead of the form', async () => {
		getEntry.mockResolvedValue(null);
		mount();
		await settle();

		expect(screen.getByText('Odometer entry not found')).toBeInTheDocument();
		expect(screen.queryByLabelText('Odometer Reading')).toBeNull();
	});

	test('a load failure shows the error message', async () => {
		getEntry.mockRejectedValue(new Error('Forbidden'));
		mount();
		await settle();

		expect(screen.getByText("Couldn't load the reading. Forbidden.")).toBeInTheDocument();
		expect(screen.queryByLabelText('Odometer Reading')).toBeNull();
	});

	test('a non-Error load failure shows the generic message', async () => {
		getEntry.mockRejectedValue('boom');
		mount();
		await settle();

		expect(
			screen.getByText(`Couldn't load the reading. ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
	});
});

describe('edit odometer reading offline', () => {
	afterEach(() => {
		onlineStatus.current = true;
	});

	test('says editing needs a connection instead of showing a load error', async () => {
		onlineStatus.current = false;
		getEntry.mockRejectedValue(new NetworkError(new Error('Failed to fetch')));
		mount();
		await settle();

		expect(screen.getByTestId('odometer-edit-offline-notice')).toHaveTextContent(
			'Editing a reading needs a connection.'
		);
		expect(screen.queryByText(/Couldn't load the reading/)).toBeNull();
		expect(screen.queryByLabelText('Odometer reading')).toBeNull();
	});

	test('loads the form once the connection comes back', async () => {
		onlineStatus.current = false;
		getEntry.mockRejectedValueOnce(new NetworkError(new Error('Failed to fetch')));
		mount();
		await settle();

		onlineStatus.current = true;
		await settle();

		expect(odometerInput().value).toBe('45000');
		expect(screen.queryByTestId('odometer-edit-offline-notice')).toBeNull();
		expect(getEntry).toHaveBeenCalledTimes(2);
	});
});

describe('edit odometer reading latest-reading note', () => {
	test('the note is announced through a status region that is always present', async () => {
		getEntries.mockResolvedValue(latest([entry({ id: 'newest', odometer: 60000 })]));
		mount();
		await settle();

		expect(screen.getByRole('status')).toHaveTextContent('Your latest reading is 60,000.');
		expect(screen.getByRole('status')).not.toHaveTextContent('Are you sure');

		await fireEvent.input(odometerInput(), { target: { value: '61000' } });
		expect(screen.getByRole('status')).toBeEmptyDOMElement();
	});

	test('editing the reading clears its error', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '' } });
		await save();
		expect(odometerInput()).toHaveAttribute('aria-invalid', 'true');

		await fireEvent.input(odometerInput(), { target: { value: '59000' } });

		expect(odometerInput()).toHaveAttribute('aria-invalid', 'false');
		expect(screen.queryByText('Odometer reading is required')).toBeNull();
	});

	test('editing the latest entry itself never shows the note', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '100' } });

		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
	});

	test('no note when the entry is dated before the newest reading', async () => {
		getEntries.mockResolvedValue(
			latest([
				entry({ id: 'newest', odometer: 60000, recordedAt: new Date(2026, 3, 1, 12).toISOString() })
			])
		);
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '44000' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();

		await fireEvent.input(dateInput(), { target: { value: '2026-04-02' } });
		expect(screen.queryByText(LATEST_NOTE)).not.toBeNull();
	});

	test('shows the note when a same-day entry is edited at or below the newest reading', async () => {
		getEntries.mockResolvedValue(latest([entry({ id: 'newest', odometer: 60000 })]));
		mount();
		await settle();

		expect(screen.queryByText(LATEST_NOTE)).not.toBeNull();

		await fireEvent.input(odometerInput(), { target: { value: '61000' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();

		await fireEvent.input(odometerInput(), { target: { value: '59000' } });
		expect(screen.getByText(LATEST_NOTE)).toHaveTextContent('Your latest reading is 60,000.');
	});
});

describe('edit odometer reading validation', () => {
	test('a cleared reading is announced and linked to its input', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '' } });
		await save();

		const input = odometerInput();
		expect(input).toHaveAttribute('aria-invalid', 'true');
		const error = document.getElementById(input.getAttribute('aria-describedby') as string);
		expect(error).toHaveTextContent('Odometer reading is required');
		expect(error).toHaveAttribute('role', 'alert');
	});

	test('a cleared reading is required instead of being saved as 0', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '' } });
		await save();

		expect(screen.getByText('Odometer reading is required')).toBeInTheDocument();
		expect(odometerInput()).toHaveClass('border-destructive');
		expect(update).not.toHaveBeenCalled();
	});

	test('a cleared reading does not show the latest reading', async () => {
		getEntries.mockResolvedValue(latest([entry({ id: 'newest', odometer: 60000 })]));
		mount();
		await settle();

		expect(screen.queryByText(LATEST_NOTE)).not.toBeNull();
		await fireEvent.input(odometerInput(), { target: { value: '' } });
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
	});

	test('a negative reading is rejected and nothing is saved', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '-1' } });
		await save();

		expect(screen.getByText('Odometer must be 0 or greater')).toBeInTheDocument();
		expect(odometerInput()).toHaveClass('border-destructive');
		expect(update).not.toHaveBeenCalled();
	});

	test('a fractional reading that reaches validation is rejected as not whole', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '10.5' } });
		await fireEvent.submit(odometerInput().closest('form') as HTMLFormElement);
		await settle();

		expect(screen.getByText('Odometer must be a whole number')).toBeInTheDocument();
		expect(update).not.toHaveBeenCalled();
	});

	test('a cleared date is required', async () => {
		mount();
		await settle();

		await fireEvent.input(dateInput(), { target: { value: '' } });
		await save();

		expect(screen.getByText('Date is required')).toBeInTheDocument();
		expect(update).not.toHaveBeenCalled();
	});

	test('a note over 500 characters is rejected', async () => {
		mount();
		await settle();

		await fireEvent.input(noteInput(), { target: { value: 'y'.repeat(501) } });
		await save();

		expect(screen.getByText('Note must be 500 characters or less')).toBeInTheDocument();
		expect(update).not.toHaveBeenCalled();
	});
});

describe('edit odometer reading save', () => {
	test('the form actions meet the 40px tap target', async () => {
		mount();
		await settle();

		for (const name of ['Delete', 'Cancel', 'Save reading']) {
			expect(screen.getByRole('button', { name })).toHaveClass('h-10');
		}
	});

	test('saves changed values at local noon and returns to the vehicle', async () => {
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '45500' } });
		await fireEvent.input(dateInput(), { target: { value: '2026-03-16' } });
		await fireEvent.input(noteInput(), { target: { value: '' } });
		await save();

		expect(update).toHaveBeenCalledWith('o1', {
			odometer: 45500,
			recordedAt: new Date(2026, 2, 16, 12, 0, 0).toISOString(),
			note: undefined
		});
		expect(goto).toHaveBeenCalledWith('/vehicles/v1?tab=odometer');
	});

	test('returns to the returnTo target after saving', async () => {
		pageState.url = new URL('http://localhost/vehicles/v1/odometer/o1/edit?returnTo=/trips');
		mount();
		await settle();

		await save();

		expect(goto).toHaveBeenCalledWith('/trips');
	});

	test('a failed save shows the server message and stays on the page', async () => {
		update.mockRejectedValue(new Error('Reading conflicts with a later trip'));
		mount();
		await settle();

		await save();

		const error = screen.getByText(
			"Couldn't update the reading. Reading conflicts with a later trip."
		);
		expect(error).toHaveAttribute('role', 'alert');
		expect(document.activeElement).toBe(error);
		expect(goto).not.toHaveBeenCalled();
	});

	test('an out-of-order refusal is shown on the odometer field and focuses it', async () => {
		getEntries.mockResolvedValue(latest([entry({ id: 'newest', odometer: 60000 })]));
		update.mockRejectedValue(
			new ApiError('Mileage must be less than 50,000 (from later entry)', 400)
		);
		mount();
		await settle();

		await fireEvent.input(odometerInput(), { target: { value: '55000' } });
		await save();

		const input = odometerInput();
		expect(input).toHaveAttribute('aria-invalid', 'true');
		const error = document.getElementById(input.getAttribute('aria-describedby') as string);
		expect(error).toHaveTextContent('Mileage must be less than 50,000 (from later entry).');
		expect(error).toHaveAttribute('role', 'alert');
		expect(document.activeElement).toBe(input);
		expect(screen.queryByText(/Couldn't update the reading/)).toBeNull();
		expect(screen.queryByText(LATEST_NOTE)).toBeNull();
	});

	test('a failed check moves focus to the first invalid field', async () => {
		mount();
		await settle();

		await fireEvent.input(dateInput(), { target: { value: '' } });
		await fireEvent.input(noteInput(), { target: { value: 'y'.repeat(501) } });
		await save();

		expect(document.activeElement).toBe(dateInput());
	});

	test('a non-Error save failure shows the generic message', async () => {
		update.mockRejectedValue('boom');
		mount();
		await settle();

		await save();

		expect(
			screen.getByText(`Couldn't update the reading. ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
	});

	test('Save reading is disabled while saving', async () => {
		update.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();

		await save();

		expect(screen.getByRole('button', { name: 'Save reading' })).toBeDisabled();
	});

	test('Cancel and Back return without saving', async () => {
		mount();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));

		expect(goto).toHaveBeenCalledTimes(2);
		expect(goto).toHaveBeenNthCalledWith(1, '/vehicles/v1?tab=odometer');
		expect(update).not.toHaveBeenCalled();
	});
});

describe('edit odometer reading delete', () => {
	test('Cancel in the confirmation keeps the entry', async () => {
		mount();
		await settle();

		const dialog = await openDeleteDialog();
		expect(dialog).toHaveTextContent(
			"Delete the 45,000 reading from Mar 15, 2026? This can't be undone."
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		await settle();

		expect(deleteEntry).not.toHaveBeenCalled();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	test('confirming deletes the entry and navigates back', async () => {
		mount();
		await settle();

		const dialog = await openDeleteDialog();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(deleteEntry).toHaveBeenCalledWith('o1');
		expect(goto).toHaveBeenCalledWith('/vehicles/v1?tab=odometer');
	});

	test('a failed delete shows the error inside the dialog', async () => {
		deleteEntry.mockRejectedValue(new Error('Linked to a trip'));
		mount();
		await settle();

		const dialog = await openDeleteDialog();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(
			within(screen.getByRole('dialog')).getByText("Couldn't delete the reading. Linked to a trip.")
		).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});

	test('a non-Error delete failure shows the generic message', async () => {
		deleteEntry.mockRejectedValue('boom');
		mount();
		await settle();

		const dialog = await openDeleteDialog();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(
			screen.getByText(`Couldn't delete the reading. ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
	});

	test('the confirm button is disabled while deleting', async () => {
		deleteEntry.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();

		const dialog = await openDeleteDialog();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
		).toBeDisabled();
	});

	test('a save in flight counts as unsaved changes', async () => {
		update.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();

		await save();

		expect(hasPendingSave()).toBe(true);
	});
});

describe('edit odometer reading photos', () => {
	test("shows the reading's photos", async () => {
		photoMocks.getPhotos.mockResolvedValue(photoPage([photo('p1'), photo('p2')]));
		mount();
		await settle();

		expect(photoMocks.getPhotos).toHaveBeenCalledWith('odometer_entry', 'o1');
		expect(screen.getByAltText('p1.jpg')).toHaveAttribute('src', '/thumbs/odometer_entry/o1/p1');
		expect(screen.getByAltText('p2.jpg')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
	});

	test('a reading without photos shows the empty state', async () => {
		mount();
		await settle();

		expect(screen.getByText('No photos or receipts yet.')).toBeInTheDocument();
	});

	test('a confirmed photo delete removes only that photo and keeps the reading', async () => {
		photoMocks.getPhotos.mockResolvedValue(photoPage([photo('p1'), photo('p2')]));
		mount();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete p2.jpg' }));
		await settle();
		const confirm = screen.getByRole('alertdialog');
		expect(within(confirm).getByText('Delete photo?')).toBeInTheDocument();
		await fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(photoMocks.deletePhoto).toHaveBeenCalledWith('odometer_entry', 'o1', 'p2');
		expect(screen.queryByAltText('p2.jpg')).toBeNull();
		expect(screen.getByAltText('p1.jpg')).toBeInTheDocument();
		expect(deleteEntry).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});
});

describe('odometer edit page in the demo', () => {
	test('the form has no Delete button', async () => {
		getEntry.mockResolvedValue(entry());
		const signOut = signInAsDemo();
		try {
			mount();
			await settle();

			expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
		} finally {
			signOut();
		}
	});
});
