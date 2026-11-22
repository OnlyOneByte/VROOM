import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import type { ImportColumnMapping, Vehicle } from '#lib/types/index.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const { getVehicles, importExpensesCsv, showSuccess, notifyError } = vi.hoisted(() => ({
	getVehicles: vi.fn<() => Promise<Vehicle[]>>(),
	importExpensesCsv:
		vi.fn<
			(csv: string, dryRun: boolean, mapping?: ImportColumnMapping) => Promise<ExpenseImportResult>
		>(),
	showSuccess: vi.fn<(message: string) => void>(),
	notifyError: vi.fn<(error: unknown, context?: string) => void>()
}));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
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
		expect(screen.getByText('Choose your Fuelio export (.csv)')).toBeInTheDocument();
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
			targetVehicle: '2019 Toyota Corolla'
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

		expect(screen.getByText(/Reading your Fuelio file/)).toBeInTheDocument();
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
		expect(preview).toHaveTextContent('Parking, Tolls');
		expect(commitButton()).toHaveTextContent('Migrate 1 entry');
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

		expect(importExpensesCsv).not.toHaveBeenCalled();
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
		expect(screen.getByText('Choose your Fuelio export (.csv)')).toBeInTheDocument();
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
		expect(screen.getByText('Choose your Fuelio export (.csv)')).toBeInTheDocument();
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
});
