import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import ImportExpensesDialog from '../../ImportExpensesDialog.svelte';

const mocks = vi.hoisted(() => ({
	detectImportSource: vi.fn(),
	getImportFormats: vi.fn(),
	importExpensesCsv: vi.fn(),
	addNotification: vi.fn()
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		detectImportSource: mocks.detectImportSource,
		getImportFormats: mocks.getImportFormats,
		importExpensesCsv: mocks.importExpensesCsv
	}
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		addNotification: mocks.addNotification,
		showSuccess: (message: string) => mocks.addNotification({ type: 'success', message })
	}
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
	return screen.getByRole('button', {
		name: /^Import \d+ expenses?$|Importing|Updating/
	}) as HTMLButtonElement;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.detectImportSource.mockResolvedValue(null);
	mocks.getImportFormats.mockResolvedValue({
		formats: [
			{ id: 'fuelio', label: 'Fuelio' },
			{ id: 'fuelly', label: 'Fuelly' }
		],
		accept: ['.csv', 'text/csv']
	});
	mocks.importExpensesCsv.mockResolvedValue(previewResult());
});

describe('ImportExpensesDialog', () => {
	test('Import is off while a re-preview updates the result, and the new result is announced', async () => {
		let land: (value: ExpenseImportResult) => void = () => {};
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		mocks.importExpensesCsv
			.mockResolvedValueOnce(previewResult({ unmappedCategories: ['Tolls'] }))
			.mockReturnValue(new Promise(resolve => (land = resolve)));
		renderDialog();
		await chooseFile(FUEL_CSV, 'fuel.csv');
		await waitFor(() => expect(importButton()).toBeEnabled());

		const trigger = await screen.findByLabelText('Category for Tolls');
		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Maintenance' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent('Updating the preview…')
		);

		expect(screen.getByText('2 ready')).toBeInTheDocument();
		expect(importButton()).toBeDisabled();
		expect(importButton()).toHaveTextContent('Updating…');

		land(previewResult({ readyCount: 1, errorCount: 1, totalRows: 2 }));
		await waitFor(() =>
			expect(screen.getByRole('status')).toHaveTextContent(
				'Preview: 1 ready, 1 row needs attention.'
			)
		);
		expect(importButton()).toHaveTextContent('Import 1 expense');
		expect(importButton()).toBeEnabled();
	});

	test('a re-preview with the same counts announces the result once and clears Updating…', async () => {
		let land: (value: ExpenseImportResult) => void = () => {};
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		mocks.importExpensesCsv
			.mockResolvedValueOnce(previewResult({ unmappedCategories: ['Tolls'] }))
			.mockReturnValue(new Promise(resolve => (land = resolve)));
		renderDialog();
		await chooseFile(FUEL_CSV, 'fuel.csv');
		await waitFor(() => expect(importButton()).toBeEnabled());
		const status = screen.getByRole('status');

		const trigger = await screen.findByLabelText('Category for Tolls');
		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Maintenance' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);
		await waitFor(() => expect(status).toHaveTextContent('Updating the preview…'));
		expect(screen.getByTestId('preview-updating')).toBeInTheDocument();

		const announced: string[] = [];
		new MutationObserver(() => announced.push(status.textContent?.trim() ?? '')).observe(status, {
			childList: true,
			characterData: true,
			subtree: true
		});
		land(previewResult());

		await waitFor(() => expect(status).toHaveTextContent('Preview: 2 ready.'));
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(announced.filter(text => text === 'Preview: 2 ready.')).toHaveLength(1);
		expect(screen.queryByTestId('preview-updating')).toBeNull();
		expect(importButton()).toHaveTextContent('Import 2 expenses');
		expect(importButton()).toBeEnabled();
	});

	test('a category remap keeps its row and keyboard focus through the re-preview', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		mocks.importExpensesCsv
			.mockResolvedValueOnce(previewResult({ unmappedCategories: ['Tolls'] }))
			.mockResolvedValue(previewResult({ unmappedCategories: [] }));
		renderDialog();
		await chooseFile(FUEL_CSV, 'fuel.csv');

		const trigger = await screen.findByLabelText('Category for Tolls');
		trigger.focus();
		await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
		await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
		const option = await screen.findByRole('option', { name: 'Maintenance' });
		await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
		await fireEvent.click(option);
		await waitFor(() => expect(mocks.importExpensesCsv).toHaveBeenCalledTimes(2));

		expect(screen.getByLabelText('Category for Tolls')).toBe(trigger);
		expect(trigger).toHaveTextContent('Maintenance');
		expect(document.activeElement).toBe(trigger);
	});

	test('names the formats and file types the server lists', async () => {
		renderDialog();

		await waitFor(() =>
			expect(
				screen.getByText(/a fuel log from another app such as Fuelio or Fuelly/)
			).toBeInTheDocument()
		);
		expect(screen.getByText('Choose a .csv file')).toBeInTheDocument();
		expect(mocks.getImportFormats).toHaveBeenCalledTimes(1);
	});

	test('still opens when the format list cannot load', async () => {
		mocks.getImportFormats.mockRejectedValue(new Error('offline'));
		renderDialog();

		await waitFor(() => expect(screen.getByText('Choose a file')).toBeInTheDocument());
		expect(screen.getByText(/a fuel log from another app —/)).toBeInTheDocument();
	});

	test('starts with nothing to import and the import button disabled', () => {
		renderDialog();

		expect(screen.getByText('Import from CSV')).toBeInTheDocument();
		expect(importButton()).toHaveTextContent('Import 0 expenses');
		expect(importButton()).toBeDisabled();
	});

	test('a detected fuel log previews and imports its ready rows, then closes', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const { onImported } = renderDialog();

		await chooseFile(FUEL_CSV, 'fuel.csv');

		await waitFor(() => expect(importButton()).toHaveTextContent('Import 2 expenses'));
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
		await waitFor(() => expect(screen.queryByText('Import from CSV')).toBeNull());
	});

	test('a single ready row is labelled in the singular', async () => {
		mocks.importExpensesCsv.mockResolvedValue(previewResult({ readyCount: 1, totalRows: 1 }));
		renderDialog();

		await chooseFile('date,vehicle,category,amount\n2026-01-02,Camry,fuel,40', 'vroom.csv');

		await waitFor(() => expect(importButton()).toHaveTextContent('Import 1 expense'));
	});

	test('an unrecognized file opens the manual column mapping panel', async () => {
		renderDialog();

		await chooseFile(FOREIGN_CSV, 'bank.csv');

		await waitFor(() => expect(screen.getByTestId('column-mapping')).toBeInTheDocument());
		expect(
			screen.getByText('bank.csv · 1 row. Match each column to a VROOM field.')
		).toBeInTheDocument();
		expect(screen.getByLabelText('Spent')).toHaveTextContent('Amount *');
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
		expect(screen.getByText('Import from CSV')).toBeInTheDocument();
	});

	test('cancel closes the dialog and discards the loaded file', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const { rerender } = renderDialog();
		await chooseFile(FUEL_CSV, 'fuel.csv');
		await waitFor(() => expect(screen.getByText('fuel.csv')).toBeInTheDocument());

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(screen.queryByText('Import from CSV')).toBeNull());

		await rerender({ open: true });

		await waitFor(() => expect(screen.getByText('Choose a .csv file')).toBeInTheDocument());
		expect(importButton()).toHaveTextContent('Import 0 expenses');
	});
});
