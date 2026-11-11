import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Vehicle } from '$lib/types';
import type { ExpenseImportResult } from '$lib/services/expense-api';
import type { ImportMappingPreset } from '$lib/types/import-mapping';
import { ImportExpensesForm } from '../import-expenses-form.svelte';

const mocks = vi.hoisted(() => ({
	detectImportSource: vi.fn(),
	importExpensesCsv: vi.fn(),
	addNotification: vi.fn()
}));

vi.mock('$lib/services/expense-api', () => ({
	expenseApi: {
		detectImportSource: mocks.detectImportSource,
		importExpensesCsv: mocks.importExpensesCsv
	}
}));

vi.mock('$lib/stores/app.svelte', () => ({
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
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4' };

const FUELLY: ImportMappingPreset = {
	id: 'fuelly',
	label: 'Fuelly',
	signature: ['date', 'cost'],
	columns: { date: 'Date', amount: 'Cost' },
	dateFormat: 'mdy'
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

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.detectImportSource.mockResolvedValue(null);
	mocks.importExpensesCsv.mockResolvedValue(previewResult());
});

describe('ImportExpensesForm: loading a file', () => {
	test('a detected fuel-log preset with one vehicle targets it and previews with the preset mapping', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));

		expect(form.fileName).toBe('fuel.csv');
		expect(mocks.detectImportSource).toHaveBeenCalledWith(['Date', 'Cost']);
		expect(form.targetVehicleId).toBe('v1');
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUEL_CSV,
			true,
			expect.objectContaining({ source: 'fuelly', targetVehicle: '2020 Toyota Camry' })
		);
		expect(form.preview?.readyCount).toBe(2);
	});

	test('a detected preset with several vehicles waits for a target before previewing', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY, RAV4]);

		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));

		expect(form.needsTargetVehicle).toBe(true);
		expect(mocks.importExpensesCsv).not.toHaveBeenCalled();

		form.changeTargetVehicle('v2');
		await flush();

		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUEL_CSV,
			true,
			expect.objectContaining({ targetVehicle: '2020 Toyota RAV4' })
		);
	});

	test('an unrecognized file starts manual mapping and previews only once Date and Amount are mapped', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));

		expect(form.manualMapping).toBe(true);
		expect(form.manualColumns).toMatchObject({ date: 'Transaction Date', amount: 'Spent' });
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FOREIGN_CSV,
			true,
			expect.objectContaining({ columns: expect.objectContaining({ amount: 'Spent' }) })
		);
	});

	test('a file with the native VROOM headers imports without manual mapping', async () => {
		const nativeCsv = 'date,vehicle,category,amount\n2026-01-02,Camry,fuel,40';
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([nativeCsv], 'vroom.csv'));

		expect(form.manualMapping).toBe(false);
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(nativeCsv, true, undefined);
	});
});

describe('ImportExpensesForm: committing an import', () => {
	test('commit imports the previewed rows, notifies, and reports success', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ dryRun: false, imported: 2 }));
		const onImported = vi.fn();

		expect(await form.commit(onImported)).toBe(true);

		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FUEL_CSV,
			false,
			expect.objectContaining({ source: 'fuelly' })
		);
		expect(mocks.addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: 'Imported 2 expenses'
		});
		expect(onImported).toHaveBeenCalledOnce();
		expect(form.isImporting).toBe(false);
	});

	test('commit is a no-op when nothing is ready to import', async () => {
		mocks.importExpensesCsv.mockResolvedValue(previewResult({ readyCount: 0, errorCount: 2 }));
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));
		form.setManualColumn('date', 'Transaction Date');
		await flush();
		const onImported = vi.fn();
		const callsBeforeCommit = mocks.importExpensesCsv.mock.calls.length;

		expect(await form.commit(onImported)).toBe(false);

		expect(mocks.importExpensesCsv).toHaveBeenCalledTimes(callsBeforeCommit);
		expect(onImported).not.toHaveBeenCalled();
	});

	test('a failed commit reports failure, skips onImported, and clears the importing flag', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockRejectedValueOnce(new Error('network down'));
		const onImported = vi.fn();

		expect(await form.commit(onImported)).toBe(false);

		expect(onImported).not.toHaveBeenCalled();
		expect(form.isImporting).toBe(false);
	});
});

describe('ImportExpensesForm: reset', () => {
	test('reset returns every field to its initial value so a reopened dialog starts clean', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));

		form.reset();

		expect(form.csvText).toBe('');
		expect(form.fileName).toBeNull();
		expect(form.preview).toBeNull();
		expect(form.detectedPreset).toBeNull();
		expect(form.targetVehicleId).toBe('');
		expect(form.fileHeaders).toEqual([]);
		expect(form.manualMapping).toBe(false);
		expect(form.manualColumns).toEqual({});
		expect(form.manualDateFormat).toBe('iso');
		expect(form.manualDistanceUnit).toBe('miles');
		expect(form.manualVolumeUnit).toBe('gallons_us');
		expect(form.categoryRemap).toEqual({});
	});
});
