import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { ConfirmDraftInput, ReceiptDraftItem } from '#lib/services/photos-import-api.ts';
import type { Vehicle } from '#lib/types/index.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const mocks = vi.hoisted(() => ({
	getReceiptDrafts: vi.fn<() => Promise<ReceiptDraftItem[]>>(),
	confirmDraft: vi.fn<(photoId: string, input: ConfirmDraftInput) => Promise<{ id: string }>>(),
	showSuccess: vi.fn(),
	showError: vi.fn()
}));

vi.mock('#lib/services/photos-import-api.ts', () => ({
	photosImportApi: {
		getReceiptDrafts: mocks.getReceiptDrafts,
		confirmDraft: mocks.confirmDraft
	}
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showSuccess: mocks.showSuccess, showError: mocks.showError }
}));

import ImportFromPhotosDialog from '../ImportFromPhotosDialog.svelte';

const DISCLOSURE_KEY = 'vroom.photos.import-disclosed';

const CAMRY: Vehicle = {
	id: 'v1',
	year: 2020,
	make: 'Toyota',
	model: 'Camry',
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4' };

function draftItem(photoId: string, overrides: Partial<ReceiptDraftItem> = {}): ReceiptDraftItem {
	return {
		photoId,
		draft: { amount: 42, category: 'maintenance', date: '2026-01-05' },
		thumbnailUrl: `/thumb/${photoId}`,
		...overrides
	};
}

function mount(vehicles: Vehicle[] = [CAMRY, RAV4]) {
	const onImported = vi.fn();
	const view = render(ImportFromPhotosDialog, { open: true, vehicles, onImported });
	return { ...view, onImported };
}

function rows(): HTMLElement[] {
	return screen.queryAllByTestId('photos-import-row');
}

function confirmButton(): HTMLElement {
	return screen.getByTestId('photos-import-confirm');
}

async function pick(trigger: HTMLElement, name: string): Promise<void> {
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	localStorage.setItem(DISCLOSURE_KEY, '1');
	mocks.getReceiptDrafts.mockResolvedValue([]);
	mocks.confirmDraft.mockResolvedValue({ id: 'e1' });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ImportFromPhotosDialog: privacy disclosure', () => {
	test('the first open explains what is read before sweeping the album', async () => {
		localStorage.clear();
		mount();

		expect(
			await screen.findByText(
				/reads only the receipt photos it uploaded to your Google Photos album/
			)
		).toBeInTheDocument();
		expect(mocks.getReceiptDrafts).not.toHaveBeenCalled();
	});

	test('continuing remembers the choice and sweeps the album', async () => {
		localStorage.clear();
		mount();

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

		await waitFor(() => expect(mocks.getReceiptDrafts).toHaveBeenCalledOnce());
		expect(localStorage.setItem).toHaveBeenCalledWith(DISCLOSURE_KEY, '1');
	});

	test('continuing still sweeps when storage is unavailable', async () => {
		localStorage.clear();
		vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
			throw new Error('blocked');
		});
		mount();

		await fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

		await waitFor(() => expect(mocks.getReceiptDrafts).toHaveBeenCalledOnce());
	});

	test('cancelling the disclosure closes everything without sweeping', async () => {
		localStorage.clear();
		mount();

		const cancels = await screen.findAllByRole('button', { name: 'Cancel' });
		await fireEvent.click(cancels[cancels.length - 1] as HTMLElement);

		await waitFor(() => expect(screen.queryByText('Import receipts from Photos')).toBeNull());
		expect(mocks.getReceiptDrafts).not.toHaveBeenCalled();
	});
});

describe('ImportFromPhotosDialog: loading drafts', () => {
	test('shows a loading skeleton while the album is swept', async () => {
		mocks.getReceiptDrafts.mockImplementation(() => new Promise(() => {}));
		mount();

		expect(await screen.findByTestId('photos-import-loading')).toBeInTheDocument();
	});

	test('a failed sweep shows the reason and can be retried', async () => {
		mocks.getReceiptDrafts
			.mockRejectedValueOnce(new Error('Google Photos is not connected'))
			.mockResolvedValueOnce([draftItem('p1')]);
		mount();

		expect(await screen.findByTestId('photos-import-error')).toHaveTextContent(
			'Google Photos is not connected'
		);
		expect(screen.queryByTestId('photos-import-confirm')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(rows()).toHaveLength(1));
		expect(mocks.getReceiptDrafts).toHaveBeenCalledTimes(2);
	});

	test.each([
		[502, "The AI provider didn't accept its key. Check it in Settings, then try again."],
		[503, 'Google Photos is limiting requests right now. Try again in a few minutes.']
	])('a stopped sweep (%i) shows what the server says went wrong', async (status, message) => {
		mocks.getReceiptDrafts.mockRejectedValue(new ApiError(message, status, undefined, 'AppError'));
		mount();

		expect(await screen.findByTestId('photos-import-error')).toHaveTextContent(message);
	});

	test('a proxy error page keeps the generic wording, not the status text', async () => {
		mocks.getReceiptDrafts.mockRejectedValue(new ApiError('Request failed with status 503', 503));
		mount();

		expect(await screen.findByTestId('photos-import-error')).toHaveTextContent(
			SERVER_FAILURE_MESSAGE
		);
	});

	test('a non-Error failure gets a generic explanation', async () => {
		mocks.getReceiptDrafts.mockRejectedValue('nope');
		mount();

		expect(await screen.findByTestId('photos-import-error')).toHaveTextContent(
			UNEXPECTED_FAILURE_MESSAGE
		);
	});

	test('prefills each row from its draft and defaults to the first vehicle', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([
			draftItem('p1'),
			draftItem('p2', { thumbnailUrl: null })
		]);
		mount();

		await waitFor(() => expect(rows()).toHaveLength(2));
		const [first] = rows();
		expect(first?.querySelector('input[type="number"]')).toHaveValue(42);
		expect(first).toHaveTextContent('January 5, 2026');
		expect(first).toHaveTextContent('Maintenance');
		expect(first).toHaveTextContent('2020 Toyota Camry');
		expect(screen.getAllByAltText('Receipt')).toHaveLength(1);
		expect(confirmButton()).toHaveTextContent('Add 2 expenses');
	});

	test('a draft with no amount, category or date gets blanks, Misc and today', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 4, 9, 12, 0, 0));
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1', { draft: {} })]);
		mount();

		await waitFor(() => expect(rows()).toHaveLength(1));
		const row = rows()[0] as HTMLElement;
		expect(row.querySelector('input[type="number"]')).toHaveValue(null);
		expect(row).toHaveTextContent('May 9, 2026');
		expect(row).toHaveTextContent('Misc');
		expect(confirmButton()).toHaveTextContent('Add 0 expenses');
		expect(confirmButton()).toBeDisabled();
	});

	test('a receipt that could not be read says so and starts left out', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([
			draftItem('p1', { draft: {}, failed: true }),
			draftItem('p2')
		]);
		mount();

		await waitFor(() => expect(rows()).toHaveLength(2));
		const [unread, read] = rows() as HTMLElement[];
		expect(within(unread as HTMLElement).getByTestId('photos-import-unread')).toHaveTextContent(
			"Couldn't read this receipt. Tick it and fill in the details to add it."
		);
		const box = within(unread as HTMLElement).getByRole('checkbox');
		expect(box).not.toBeChecked();
		expect(box).toHaveAccessibleDescription(
			"Couldn't read this receipt. Tick it and fill in the details to add it."
		);
		expect(within(read as HTMLElement).queryByTestId('photos-import-unread')).toBeNull();
	});

	test('with no vehicles a row asks for one and cannot be added', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1')]);
		mount([]);

		await waitFor(() => expect(rows()).toHaveLength(1));
		expect(rows()[0]).toHaveTextContent('Select a vehicle');
		expect(confirmButton()).toBeDisabled();
	});
});

describe('ImportFromPhotosDialog: reviewing and importing', () => {
	test('excluding a receipt disables its fields and drops it from the count', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1'), draftItem('p2')]);
		mount();
		await waitFor(() => expect(rows()).toHaveLength(2));

		await fireEvent.click(
			screen.getAllByRole('checkbox', { name: 'Include this receipt' })[1] as HTMLElement
		);

		await waitFor(() => expect(confirmButton()).toHaveTextContent('Add 1 expense'));
		const excluded = rows()[1] as HTMLElement;
		expect(excluded.className).toContain('opacity-50');
		expect(excluded.querySelector('input[type="number"]')).toBeDisabled();
	});

	test('adds each included receipt with the reviewed values, then closes', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1'), draftItem('p2')]);
		const { onImported } = mount();
		await waitFor(() => expect(rows()).toHaveLength(2));
		const first = rows()[0] as HTMLElement;

		await fireEvent.input(first.querySelector('input[type="number"]') as HTMLInputElement, {
			target: { value: '55.5' }
		});
		await pick(document.getElementById('photo-p1-category') as HTMLElement, 'Fuel & charging');
		await pick(document.getElementById('photo-p1-vehicle') as HTMLElement, '2020 Toyota RAV4');
		await fireEvent.click(confirmButton());

		await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
		expect(mocks.confirmDraft).toHaveBeenCalledTimes(2);
		expect(mocks.confirmDraft).toHaveBeenNthCalledWith(
			1,
			'p1',
			expect.objectContaining({ vehicleId: 'v2', category: 'fuel', amount: 55.5 })
		);
		expect(mocks.confirmDraft).toHaveBeenNthCalledWith(
			2,
			'p2',
			expect.objectContaining({ vehicleId: 'v1', category: 'maintenance', amount: 42 })
		);
		const date = mocks.confirmDraft.mock.calls[1]?.[1].date as string;
		expect(new Date(date).getDate()).toBe(5);
		expect(mocks.showSuccess).toHaveBeenCalledWith('Added 2 expenses from Photos');
		await waitFor(() => expect(screen.queryByText('Import receipts from Photos')).toBeNull());
	});

	test('a single added receipt is announced in the singular', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1')]);
		mount();
		await waitFor(() => expect(rows()).toHaveLength(1));

		await fireEvent.click(confirmButton());

		await waitFor(() =>
			expect(mocks.showSuccess).toHaveBeenCalledWith('Added 1 expense from Photos')
		);
	});

	test('a failed add reports the error and keeps the review open', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1'), draftItem('p2')]);
		mocks.confirmDraft
			.mockResolvedValueOnce({ id: 'e1' })
			.mockRejectedValueOnce(new Error('Vehicle not found'));
		const { onImported } = mount();
		await waitFor(() => expect(rows()).toHaveLength(2));

		await fireEvent.click(confirmButton());

		await waitFor(() =>
			expect(mocks.showError).toHaveBeenCalledWith("Couldn't add some expenses. Vehicle not found.")
		);
		expect(onImported).not.toHaveBeenCalled();
		expect(rows()).toHaveLength(2);
		expect(confirmButton()).toBeEnabled();
	});

	test('a non-Error add failure gets a generic message', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1')]);
		mocks.confirmDraft.mockRejectedValue('nope');
		mount();
		await waitFor(() => expect(rows()).toHaveLength(1));

		await fireEvent.click(confirmButton());

		await waitFor(() =>
			expect(mocks.showError).toHaveBeenCalledWith(
				`Couldn't add some expenses. ${UNEXPECTED_FAILURE_MESSAGE}`
			)
		);
	});

	test('shows a busy state while receipts are being added', async () => {
		mocks.getReceiptDrafts.mockResolvedValue([draftItem('p1')]);
		mocks.confirmDraft.mockImplementation(() => new Promise(() => {}));
		mount();
		await waitFor(() => expect(rows()).toHaveLength(1));

		await fireEvent.click(confirmButton());

		await waitFor(() => expect(confirmButton()).toHaveTextContent('Adding…'));
		expect(confirmButton()).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});
});
