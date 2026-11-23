import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import type { ImportColumnMapping, Vehicle } from '#lib/types/index.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const { getVehicles, detectImportSource, importExpensesCsv, showSuccess, notifyError } = vi.hoisted(
	() => ({
		getVehicles: vi.fn<() => Promise<Vehicle[]>>(),
		detectImportSource: vi.fn<(sample: string) => Promise<DetectedImportFormat | null>>(),
		importExpensesCsv:
			vi.fn<
				(
					csv: string,
					dryRun: boolean,
					mapping?: ImportColumnMapping
				) => Promise<ExpenseImportResult>
			>(),
		showSuccess: vi.fn<(message: string) => void>(),
		notifyError: vi.fn<(error: unknown, context?: string) => void>()
	})
);

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		detectImportSource: (sample: string) => detectImportSource(sample),
		getImportFormats: () =>
			Promise.resolve({
				formats: [{ id: 'fuelio', label: 'Fuelio' }],
				accept: ['.csv', 'text/csv']
			}),
		importExpensesCsv: (csv: string, dryRun: boolean, mapping?: ImportColumnMapping) =>
			importExpensesCsv(csv, dryRun, mapping)
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showSuccess: (message: string) => showSuccess(message) }
}));
vi.mock('#lib/utils/error-handling.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/error-handling.ts')>()),
	handleErrorWithNotification: (error: unknown, context?: string) => notifyError(error, context)
}));

const MigrateFromTrackerCard = (await import('../MigrateFromTrackerCard.svelte')).default;

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
	return {
		id: 'v1',
		make: 'Toyota',
		model: 'Corolla',
		year: 2019,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function result(overrides: Partial<ExpenseImportResult> = {}): ExpenseImportResult {
	return {
		dryRun: true,
		imported: 0,
		readyCount: 3,
		errorCount: 0,
		totalRows: 3,
		rows: [
			{ row: 1, status: 'ready' },
			{ row: 2, status: 'ready' },
			{ row: 3, status: 'ready' }
		],
		...overrides
	};
}

const CSV = 'Data,Odo (km),Fuel (litres)\n2026-01-01,1000,40\n';

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount() {
	const view = render(MigrateFromTrackerCard);
	await settle();
	return view;
}

async function openDialog() {
	await fireEvent.click(screen.getByTestId('migrate-open'));
	await settle();
}

async function chooseFile(contents = CSV, name = 'fuelio.csv') {
	const input = screen.getByTestId('migrate-file') as HTMLInputElement;
	const file = new File([contents], name, { type: 'text/csv' });
	Object.defineProperty(input, 'files', { value: [file], configurable: true });
	await fireEvent.change(input);
	await settle();
}

async function pickVehicle(name: string) {
	await fireEvent.click(screen.getByTestId('migrate-vehicle'));
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name }));
	await settle();
}

function commitButton() {
	return screen.getByTestId('migrate-commit') as HTMLButtonElement;
}

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockResolvedValue([vehicle()]);
	detectImportSource.mockResolvedValue({ id: 'fuelio', label: 'Fuelio' });
	importExpensesCsv.mockResolvedValue(result());
});

afterEach(() => {
	cleanup();
});

describe('MigrateFromTrackerCard card states', () => {
	test('shows a spinner while vehicles load', async () => {
		getVehicles.mockReturnValue(new Promise(() => {}));
		await mount();
		expect(screen.getByTestId('migrate-loading')).toBeInTheDocument();
	});

	test('a vehicle load failure shows the message and Retry reloads', async () => {
		getVehicles.mockRejectedValueOnce(new ApiError('SQLITE_BUSY: database is locked', 500));
		await mount();
		expect(screen.getByTestId('migrate-error')).toHaveTextContent(
			`Couldn't load your vehicles. ${SERVER_FAILURE_MESSAGE}`
		);
		expect(screen.getByTestId('migrate-error')).not.toHaveTextContent('SQLITE_BUSY');
		const retry = screen.getByRole('button', { name: 'Retry' });
		expect(retry.className).toMatch(/(^|\s)h-10(\s|$)/);

		await fireEvent.click(retry);
		await settle();

		expect(getVehicles).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId('migrate-open')).toHaveFocus();
	});

	test('a failed Retry announces the error and keeps focus on the new Retry', async () => {
		getVehicles.mockRejectedValue(new ApiError('boom', 500));
		await mount();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
		expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your vehicles.");
		expect(getVehicles).toHaveBeenCalledTimes(2);
	});

	test('a non-Error rejection falls back to a generic load message', async () => {
		getVehicles.mockRejectedValueOnce('boom');
		await mount();
		expect(screen.getByTestId('migrate-error')).toHaveTextContent(
			`Couldn't load your vehicles. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});

	test('with no vehicles it asks the user to add one first', async () => {
		getVehicles.mockResolvedValue([]);
		await mount();
		expect(screen.getByTestId('migrate-no-vehicle')).toHaveTextContent('Add a vehicle first');
		expect(screen.queryByTestId('migrate-open')).toBeNull();
	});
});

describe('MigrateFromTrackerCard dialog flow', () => {
	test('opening the dialog preselects the only vehicle and disables commit with no file', async () => {
		await mount();
		await openDialog();

		expect(screen.getByTestId('migrate-vehicle')).toHaveTextContent('2019 Toyota Corolla');
		expect(screen.getByText('Choose your export file (.csv)')).toBeInTheDocument();
		expect(commitButton()).toBeDisabled();
		expect(commitButton()).toHaveTextContent('Migrate 0 entries');
	});

	test('choosing a file runs a dry-run preview against the selected vehicle', async () => {
		await mount();
		await openDialog();
		await chooseFile();

		expect(importExpensesCsv).toHaveBeenCalledWith(CSV, true, {
			source: 'fuelio',
			columns: {},
			dateFormat: 'iso',
			targetVehicle: '2019 Toyota Corolla',
			categoryMap: {}
		});
		expect(screen.getByText('fuelio.csv')).toBeInTheDocument();
		expect(screen.getByTestId('migrate-preview')).toHaveTextContent('3 ready');
		expect(commitButton()).toBeEnabled();
		expect(commitButton()).toHaveTextContent('Migrate 3 entries');
	});

	test('shows a reading indicator while the preview is pending', async () => {
		importExpensesCsv.mockReturnValue(new Promise(() => {}));
		await mount();
		await openDialog();
		await chooseFile();

		expect(screen.getByText(/Reading your file/)).toBeInTheDocument();
		expect(commitButton()).toBeDisabled();
	});

	test('lists rows with errors, the error count and unmapped categories', async () => {
		importExpensesCsv.mockResolvedValue(
			result({
				readyCount: 1,
				errorCount: 2,
				rows: [
					{ row: 1, status: 'ready' },
					{ row: 2, status: 'error', message: 'Missing date' },
					{ row: 3, status: 'error', message: 'Bad amount' }
				],
				unmappedCategories: ['Parking', 'Tolls']
			})
		);
		await mount();
		await openDialog();
		await chooseFile();

		const preview = screen.getByTestId('migrate-preview');
		expect(preview).toHaveTextContent('1 ready');
		expect(preview).toHaveTextContent('2 rows need attention');
		expect(preview).toHaveTextContent('Row 2');
		expect(preview).toHaveTextContent('Missing date');
		expect(preview).toHaveTextContent('Row 3');
		expect(preview).toHaveTextContent('Bad amount');
		expect(screen.getByText('Unrecognized categories')).toBeInTheDocument();
		expect(screen.getByText('Parking')).toBeInTheDocument();
		expect(screen.getByText('Tolls')).toBeInTheDocument();
		expect(commitButton()).toHaveTextContent('Migrate 1 entry');
	});

	test('a category remap is sent with the preview and the migration', async () => {
		importExpensesCsv.mockResolvedValue(result({ unmappedCategories: ['Parking'] }));
		await mount();
		await openDialog();
		await chooseFile();

		const trigger = screen.getByLabelText('Category for Parking');
		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Maintenance' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);
		await settle();

		expect(importExpensesCsv).toHaveBeenLastCalledWith(
			CSV,
			true,
			expect.objectContaining({ categoryMap: { Parking: 'maintenance' } })
		);
		await fireEvent.click(commitButton());
		await settle();
		expect(importExpensesCsv).toHaveBeenLastCalledWith(
			CSV,
			false,
			expect.objectContaining({ categoryMap: { Parking: 'maintenance' } })
		);
	});

	test('after a remap the row stays, shows the pick and keeps keyboard focus', async () => {
		importExpensesCsv.mockResolvedValueOnce(result({ unmappedCategories: ['Parking'] }));
		importExpensesCsv.mockResolvedValue(result({ unmappedCategories: [] }));
		await mount();
		await openDialog();
		await chooseFile();

		const trigger = screen.getByLabelText('Category for Parking');
		trigger.focus();
		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Maintenance' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);
		await settle();

		const after = screen.getByLabelText('Category for Parking');
		expect(after).toBe(trigger);
		expect(after).toHaveTextContent('Maintenance');
		expect(document.activeElement).toBe(trigger);
	});

	test('a vehicle picked before the file is kept for the preview', async () => {
		getVehicles.mockResolvedValue([
			vehicle(),
			vehicle({ id: 'v2', nickname: 'Weekend Car', make: 'Mazda', model: 'MX-5' })
		]);
		await mount();
		await openDialog();
		await pickVehicle('Weekend Car');
		await chooseFile();

		expect(importExpensesCsv).toHaveBeenCalledWith(
			CSV,
			true,
			expect.objectContaining({ targetVehicle: 'Weekend Car' })
		);
		expect(screen.getByTestId('migrate-vehicle')).toHaveTextContent('Weekend Car');
	});

	test('reopening keeps the vehicle picked last time, and an unrecognised file keeps it too', async () => {
		getVehicles.mockResolvedValue([
			vehicle(),
			vehicle({ id: 'v2', nickname: 'Weekend Car', make: 'Mazda', model: 'MX-5' })
		]);
		detectImportSource.mockResolvedValue(null);
		await mount();
		await openDialog();
		await pickVehicle('Weekend Car');
		await chooseFile('foo,bar\n1,2', 'other.csv');

		expect(screen.getByTestId('migrate-unrecognized')).toBeInTheDocument();
		expect(screen.getByTestId('migrate-vehicle')).toHaveTextContent('Weekend Car');

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await settle();
		await openDialog();
		expect(screen.getByTestId('migrate-vehicle')).toHaveTextContent('Weekend Car');
	});

	test('a single bad row reads in the singular', async () => {
		importExpensesCsv.mockResolvedValue(
			result({
				readyCount: 0,
				errorCount: 1,
				rows: [{ row: 4, status: 'error', message: 'Unknown vehicle' }]
			})
		);
		await mount();
		await openDialog();
		await chooseFile();

		expect(screen.getByTestId('migrate-preview')).toHaveTextContent('1 row needs attention');
		expect(commitButton()).toBeDisabled();
	});

	test('a preview failure notifies the user and shows no preview', async () => {
		const error = new ApiError('Unparseable CSV', 400);
		importExpensesCsv.mockRejectedValue(error);
		await mount();
		await openDialog();
		await chooseFile();

		expect(notifyError).toHaveBeenCalledWith(error, "Couldn't read that Fuelio file");
		expect(screen.queryByTestId('migrate-preview')).toBeNull();
		expect(commitButton()).toBeDisabled();
	});

	test('a whitespace-only file does not call the API', async () => {
		await mount();
		await openDialog();
		await chooseFile('   \n  ');

		expect(detectImportSource).not.toHaveBeenCalled();
		expect(importExpensesCsv).not.toHaveBeenCalled();
		expect(screen.queryByTestId('migrate-unrecognized')).toBeNull();
		expect(screen.queryByTestId('migrate-preview')).toBeNull();
	});

	test('a change event with no file selected does nothing', async () => {
		await mount();
		await openDialog();
		const input = screen.getByTestId('migrate-file') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [], configurable: true });
		await fireEvent.change(input);
		await settle();

		expect(importExpensesCsv).not.toHaveBeenCalled();
		expect(screen.getByText('Choose your export file (.csv)')).toBeInTheDocument();
	});

	test('with several vehicles it asks for a vehicle before previewing, then previews on pick', async () => {
		getVehicles.mockResolvedValue([
			vehicle(),
			vehicle({ id: 'v2', nickname: 'Weekend Car', make: 'Mazda', model: 'MX-5' })
		]);
		await mount();
		await openDialog();

		expect(screen.getByTestId('migrate-vehicle')).toHaveTextContent('Select a vehicle');
		await chooseFile();

		expect(importExpensesCsv).not.toHaveBeenCalled();
		expect(screen.getByText('Choose a vehicle above to preview.')).toBeInTheDocument();

		await pickVehicle('Weekend Car');

		expect(importExpensesCsv).toHaveBeenCalledWith(
			CSV,
			true,
			expect.objectContaining({ targetVehicle: 'Weekend Car' })
		);
		expect(screen.getByTestId('migrate-preview')).toBeInTheDocument();
	});

	test('committing imports for real, reports the count and closes the dialog', async () => {
		importExpensesCsv
			.mockResolvedValueOnce(result())
			.mockResolvedValueOnce(result({ dryRun: false, imported: 3 }));
		await mount();
		await openDialog();
		await chooseFile();
		await fireEvent.click(commitButton());
		await settle();

		expect(importExpensesCsv).toHaveBeenLastCalledWith(
			CSV,
			false,
			expect.objectContaining({ source: 'fuelio' })
		);
		expect(showSuccess).toHaveBeenCalledWith('Migrated 3 entries from Fuelio');
		expect(screen.queryByTestId('migrate-commit')).toBeNull();
	});

	test('a single migrated entry is reported in the singular', async () => {
		importExpensesCsv
			.mockResolvedValueOnce(result({ readyCount: 1, rows: [{ row: 1, status: 'ready' }] }))
			.mockResolvedValueOnce(result({ dryRun: false, imported: 1 }));
		await mount();
		await openDialog();
		await chooseFile();
		await fireEvent.click(commitButton());
		await settle();

		expect(showSuccess).toHaveBeenCalledWith('Migrated 1 entry from Fuelio');
	});

	test('shows a migrating state while the commit is in flight', async () => {
		importExpensesCsv.mockResolvedValueOnce(result()).mockReturnValueOnce(new Promise(() => {}));
		await mount();
		await openDialog();
		await chooseFile();
		await fireEvent.click(commitButton());
		await settle();

		expect(commitButton()).toHaveTextContent('Migrating…');
		expect(commitButton()).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});

	test('a commit failure notifies the user and keeps the dialog open', async () => {
		const error = new ApiError('Write failed', 500);
		importExpensesCsv.mockResolvedValueOnce(result()).mockRejectedValueOnce(error);
		await mount();
		await openDialog();
		await chooseFile();
		await fireEvent.click(commitButton());
		await settle();

		expect(notifyError).toHaveBeenCalledWith(error, "Couldn't migrate from Fuelio");
		expect(showSuccess).not.toHaveBeenCalled();
		expect(commitButton()).toBeEnabled();
		expect(commitButton()).toHaveTextContent('Migrate 3 entries');
	});

	test('Cancel closes the dialog and reopening starts from a clean slate', async () => {
		await mount();
		await openDialog();
		await chooseFile();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await settle();

		expect(screen.queryByTestId('migrate-preview')).toBeNull();

		await openDialog();

		expect(screen.queryByTestId('migrate-preview')).toBeNull();
		expect(screen.getByText('Choose your export file (.csv)')).toBeInTheDocument();
		expect(commitButton()).toBeDisabled();
	});

	test('a stale preview that resolves after the dialog is reopened is discarded', async () => {
		let resolveStale: (value: ExpenseImportResult) => void = () => {};
		importExpensesCsv.mockReturnValueOnce(
			new Promise<ExpenseImportResult>(r => {
				resolveStale = r;
			})
		);
		await mount();
		await openDialog();
		await chooseFile();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await settle();
		await openDialog();

		resolveStale(result());
		await settle();

		expect(screen.queryByTestId('migrate-preview')).toBeNull();
		expect(commitButton()).toBeDisabled();
	});

	test('the detected format drives the mapping source and the success message', async () => {
		detectImportSource.mockResolvedValue({ id: 'fuelly', label: 'Fuelly' });
		await mount();
		await openDialog();
		await chooseFile();

		expect(detectImportSource).toHaveBeenCalledWith(CSV);
		expect(importExpensesCsv).toHaveBeenCalledWith(
			CSV,
			true,
			expect.objectContaining({ source: 'fuelly' })
		);
		importExpensesCsv.mockResolvedValueOnce(result({ dryRun: false, imported: 2 }));
		await fireEvent.click(commitButton());
		await settle();
		expect(showSuccess).toHaveBeenCalledWith('Migrated 2 entries from Fuelly');
	});

	test('an unrecognized file says so and never previews', async () => {
		detectImportSource.mockResolvedValue(null);
		await mount();
		await openDialog();
		await chooseFile('a,b\n1,2', 'other.csv');

		expect(screen.getByTestId('migrate-unrecognized')).toHaveTextContent(
			"We don't recognize this file."
		);
		expect(importExpensesCsv).not.toHaveBeenCalled();
		expect(commitButton()).toBeDisabled();
	});

	test('a detection that resolves after a newer file is picked is discarded', async () => {
		let resolveStale: (value: DetectedImportFormat | null) => void = () => {};
		detectImportSource.mockReturnValueOnce(
			new Promise<DetectedImportFormat | null>(r => {
				resolveStale = r;
			})
		);
		detectImportSource.mockResolvedValueOnce({ id: 'fuelly', label: 'Fuelly' });
		await mount();
		await openDialog();
		const input = screen.getByTestId('migrate-file') as HTMLInputElement;
		Object.defineProperty(input, 'files', {
			value: [new File(['a,b\n1,2'], 'old.csv')],
			configurable: true
		});
		await fireEvent.change(input);
		await chooseFile(CSV, 'new.csv');

		resolveStale(null);
		await settle();

		expect(screen.queryByTestId('migrate-unrecognized')).toBeNull();
		expect(importExpensesCsv).toHaveBeenCalledTimes(1);
		expect(importExpensesCsv).toHaveBeenCalledWith(
			CSV,
			true,
			expect.objectContaining({ source: 'fuelly' })
		);
	});

	test('picking a blank file while a detection is in flight clears the reading state', async () => {
		detectImportSource.mockReturnValueOnce(new Promise(() => {}));
		await mount();
		await openDialog();
		await chooseFile();
		expect(screen.getByText(/Reading your file/)).toBeInTheDocument();

		await chooseFile('   \n', 'blank.csv');

		expect(screen.queryByText(/Reading your file/)).toBeNull();
	});
});
