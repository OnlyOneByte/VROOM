import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Vehicle } from '#lib/types/index.ts';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import { ImportExpensesForm } from '../import-expenses-form.svelte';

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
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4' };

const FUELLY: DetectedImportFormat = {
	id: 'fuelly',
	label: 'Fuelly'
};

const FUEL_CSV = 'Date,Cost\n01/02/2026,40.00\n01/09/2026,42.50';
const FOREIGN_CSV = 'Transaction Date,Spent,Kind\n2026-01-02,40,gas';
const FUELIO_EXPORT = [
	'"## Vehicle"',
	'"Name","ImportCSVDateFormat","Make","Model","Year"',
	'"Golf","yyyy-MM-dd","Volkswagen","Golf","2018"',
	'',
	'"## Log"',
	'"Data","Odo (km)","Fuel (litres)","Full","Price (optional)"',
	'"2024-01-05","45210","42.10","1","68.90"'
].join('\n');

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
		expect(mocks.detectImportSource).toHaveBeenCalledWith(FUEL_CSV);
		expect(form.targetVehicleId).toBe('v1');
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUEL_CSV,
			true,
			expect.objectContaining({ source: 'fuelly', targetVehicle: '2020 Toyota Camry' })
		);
		expect(form.preview?.readyCount).toBe(2);
	});

	test('the server sees the raw sample even when the first line has no CSV headers', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		const text = `\n${FUEL_CSV}`;

		await form.loadFile(new File([text], 'fuel.txt'));

		expect(mocks.detectImportSource).toHaveBeenCalledWith(text);
		expect(form.detectedPreset).toEqual(FUELLY);
		expect(form.targetVehicleId).toBe('v1');
		expect(form.manualMapping).toBe(false);
	});

	test('an unrecognised file with no CSV headers gets no guessed columns', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File(['\n{"log": []}'], 'log.json'));

		expect(mocks.detectImportSource).toHaveBeenCalled();
		expect(form.detectedPreset).toBeNull();
		expect(form.manualMapping).toBe(false);
		expect(form.manualColumns).toEqual({});
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

	test('a Fuelio export is detected from its sample and needs no manual mapping', async () => {
		mocks.detectImportSource.mockResolvedValue({ id: 'fuelio', label: 'Fuelio' });
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([FUELIO_EXPORT], 'fuelio.csv'));

		expect(mocks.detectImportSource).toHaveBeenCalledWith(FUELIO_EXPORT);
		expect(form.detectedPreset?.label).toBe('Fuelio');
		expect(form.manualMapping).toBe(false);
		expect(form.targetVehicleId).toBe('v1');
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUELIO_EXPORT,
			true,
			expect.objectContaining({ source: 'fuelio', targetVehicle: '2020 Toyota Camry' })
		);
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

describe('ImportExpensesForm: pasted text and detection failures', () => {
	test('blurring pasted CSV detects the source and previews it', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		form.csvText = FUEL_CSV;

		await form.handlePasteBlur();

		expect(mocks.detectImportSource).toHaveBeenCalledWith(FUEL_CSV);
		expect(form.detectedPreset).toEqual(FUELLY);
		expect(form.preview?.readyCount).toBe(2);
	});

	test('detection sends only the first 8 KB of a large file', async () => {
		const big = `Date,Cost\n${'01/02/2026,40.00\n'.repeat(1000)}`;
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([big], 'big.csv'));

		expect(mocks.detectImportSource).toHaveBeenCalledWith(big.slice(0, 8192));
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(big, true, expect.anything());
	});

	test('blank pasted text clears the preview without calling the API', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);
		form.preview = previewResult();
		form.csvText = '   ';

		await form.handlePasteBlur();

		expect(form.preview).toBeNull();
		expect(form.fileHeaders).toEqual([]);
		expect(mocks.detectImportSource).not.toHaveBeenCalled();
		expect(mocks.importExpensesCsv).not.toHaveBeenCalled();
	});

	test('a failed source detection falls back to no preset and stops detecting', async () => {
		mocks.detectImportSource.mockRejectedValue(new Error('offline'));
		const form = new ImportExpensesForm(() => [CAMRY]);
		form.csvText = FUEL_CSV;

		await form.detectSource();

		expect(form.detectedPreset).toBeNull();
		expect(form.isDetecting).toBe(false);
		expect(form.manualMapping).toBe(false);
		expect(form.fileHeaders).toEqual(['Date', 'Cost']);
	});

	test('a failed preview notifies the user and clears the previewing flag', async () => {
		mocks.importExpensesCsv.mockRejectedValue(new Error('bad csv'));
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(
			new File(['date,vehicle,category,amount\n2026-01-02,Camry,fuel,40'], 'x.csv')
		);

		expect(form.preview).toBeNull();
		expect(form.isPreviewing).toBe(false);
		expect(mocks.addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining("Couldn't read that CSV")
			})
		);
	});

	test('a single imported expense is announced in the singular', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ dryRun: false, imported: 1 }));

		await form.commit(vi.fn());

		expect(mocks.addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: 'Imported 1 expense'
		});
	});
});

describe('ImportExpensesForm: manual mapping settings', () => {
	const METRIC_RAV4: Vehicle = {
		...RAV4,
		unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
	};

	test('picking a target vehicle during manual mapping adopts its distance and volume units', async () => {
		const form = new ImportExpensesForm(() => [CAMRY, METRIC_RAV4]);
		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));
		expect(form.manualDistanceUnit).toBe('miles');

		form.changeTargetVehicle('v2');
		await flush();

		expect(form.manualDistanceUnit).toBe('kilometers');
		expect(form.manualVolumeUnit).toBe('liters');
	});

	test('a sole metric vehicle seeds the manual units as soon as the file is detected', async () => {
		const form = new ImportExpensesForm(() => [METRIC_RAV4]);

		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));

		expect(form.targetVehicleId).toBe('v2');
		expect(form.manualDistanceUnit).toBe('kilometers');
		expect(form.manualVolumeUnit).toBe('liters');
	});

	test('changing the date format, units or a category remap re-previews with the new mapping', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));

		form.setManualDateFormat('dmy');
		await flush();
		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FOREIGN_CSV,
			true,
			expect.objectContaining({ dateFormat: 'dmy' })
		);

		form.setManualDistanceUnit('kilometers');
		form.setManualVolumeUnit('liters');
		form.setCategoryRemap('gas', 'fuel');
		await flush();

		expect(form.manualDistanceUnit).toBe('kilometers');
		expect(form.manualVolumeUnit).toBe('liters');
		expect(form.categoryRemap).toEqual({ gas: 'fuel' });
		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FOREIGN_CSV,
			true,
			expect.objectContaining({ categoryMap: expect.objectContaining({ gas: 'fuel' }) })
		);
	});
});
