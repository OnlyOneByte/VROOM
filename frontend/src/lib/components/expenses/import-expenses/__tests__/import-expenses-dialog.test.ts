import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import ImportExpensesDialog from '../../ImportExpensesDialog.svelte';

const mocks = vi.hoisted(() => ({
	detectImportSource: vi.fn(),
	importExpensesCsv: vi.fn(),
	addNotification: vi.fn()
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		detectImportSource: mocks.detectImportSource,
		importExpensesCsv: mocks.importExpensesCsv
	}
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { addNotification: mocks.addNotification }
}));

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

const FUELLY: DetectedImportFormat = {
	id: 'fuelly',
	label: 'Fuelly'
};

const FUEL_CSV = 'Date,Cost\n01/02/2026,40.00\n01/09/2026,42.50';
const FOREIGN_CSV = 'Transaction Date,Spent,Kind\n2026-01-02,40,gas';

function previewResult(overrides: Partial<ExpenseImportResult> = {}): ExpenseImportResult {
	return {
		dryRun: true,
		imported: 0,
		readyCount: 2,
		errorCount: 0,
		totalRows: 2,
		rows: [],
		...overrides
	};
}

function renderDialog(vehicles: Vehicle[] = [CAMRY]) {
	const onImported = vi.fn();
	const view = render(ImportExpensesDialog, { open: true, vehicles, onImported });
	return { ...view, onImported };
}

async function chooseFile(content: string, name: string): Promise<void> {
	const input = document.getElementById('import-csv-file') as HTMLInputElement;
	Object.defineProperty(input, 'files', {
		value: [new File([content], name, { type: 'text/csv' })],
		configurable: true
	});
	await fireEvent.change(input);
}

function importButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: /^Import \d+ rows?$|Importing/ }) as HTMLButtonElement;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.detectImportSource.mockResolvedValue(null);
	mocks.importExpensesCsv.mockResolvedValue(previewResult());
});

describe('ImportExpensesDialog', () => {
	test('starts with nothing to import and the import button disabled', () => {
		renderDialog();

		expect(screen.getByText('Import expenses from CSV')).toBeInTheDocument();
		expect(importButton()).toHaveTextContent('Import 0 rows');
		expect(importButton()).toBeDisabled();
	});

	test('a detected fuel log previews and imports its ready rows, then closes', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const { onImported } = renderDialog();

		await chooseFile(FUEL_CSV, 'fuel.csv');

		await waitFor(() => expect(importButton()).toHaveTextContent('Import 2 rows'));
		expect(screen.getByText('Fuelly')).toBeInTheDocument();
		expect(screen.getByText('2 ready')).toBeInTheDocument();
		expect(importButton()).toBeEnabled();

		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ dryRun: false, imported: 2 }));
		await fireEvent.click(importButton());

		await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FUEL_CSV,
			false,
			expect.objectContaining({ source: 'fuelly' })
		);
		await waitFor(() => expect(screen.queryByText('Import expenses from CSV')).toBeNull());
	});

	test('a single ready row is labelled in the singular', async () => {
		mocks.importExpensesCsv.mockResolvedValue(previewResult({ readyCount: 1, totalRows: 1 }));
		renderDialog();

		await chooseFile('date,vehicle,category,amount\n2026-01-02,Camry,fuel,40', 'vroom.csv');

		await waitFor(() => expect(importButton()).toHaveTextContent('Import 1 row'));
	});

	test('an unrecognized file opens the manual column mapping panel', async () => {
		renderDialog();

		await chooseFile(FOREIGN_CSV, 'bank.csv');

		await waitFor(() => expect(screen.getByText('Map your columns')).toBeInTheDocument());
		expect(screen.getByTestId('map-field-amount')).toHaveTextContent('Spent');
	});

	test('a failed import keeps the dialog open and does not report success', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const { onImported } = renderDialog();
		await chooseFile(FUEL_CSV, 'fuel.csv');
		await waitFor(() => expect(importButton()).toBeEnabled());

		mocks.importExpensesCsv.mockRejectedValueOnce(new Error('server down'));
		await fireEvent.click(importButton());

		await waitFor(() =>
			expect(mocks.addNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
		);
		expect(onImported).not.toHaveBeenCalled();
		expect(screen.getByText('Import expenses from CSV')).toBeInTheDocument();
	});

	test('cancel closes the dialog and discards the loaded file', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const { rerender } = renderDialog();
		await chooseFile(FUEL_CSV, 'fuel.csv');
		await waitFor(() => expect(screen.getByText('fuel.csv')).toBeInTheDocument());

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(screen.queryByText('Import expenses from CSV')).toBeNull());

		await rerender({ open: true });

		await waitFor(() => expect(screen.getByText('Choose a .csv file')).toBeInTheDocument());
		expect(importButton()).toHaveTextContent('Import 0 rows');
	});
});
