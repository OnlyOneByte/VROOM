import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
	DETECT_SAMPLE_LENGTH,
	guessManualColumns,
	isNativeImportHeaders,
	parseCsvHeaders,
	presetImportMapping,
	splitCsvLine
} from '#lib/utils/import-mapping-helpers.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';

describe('DETECT_SAMPLE_LENGTH parity with the backend', () => {
	test('matches the detect route limit, so a full sample is never refused', () => {
		const presets = resolve(
			dirname(fileURLToPath(import.meta.url)),
			'../../../../../backend/src/api/expenses/import-mapping-presets.ts'
		);
		const match = readFileSync(presets, 'utf8').match(
			/export\s+const\s+IMPORT_DETECT_SAMPLE_LENGTH\s*=\s*(\d+)/
		);
		expect(Number(match?.[1])).toBe(DETECT_SAMPLE_LENGTH);
	});
});

describe('parseCsvHeaders', () => {
	test('splits the FIRST line on commas, trimming + de-quoting each cell', () => {
		expect(parseCsvHeaders('Date, "Total Price" ,Notes\n2026-01-01,10,x')).toEqual([
			'Date',
			'Total Price',
			'Notes'
		]);
	});

	test('empty / blank input → no headers', () => {
		expect(parseCsvHeaders('')).toEqual([]);
		expect(parseCsvHeaders('   \n')).toEqual([]);
	});

	test('a single header line (no data rows) still parses', () => {
		expect(parseCsvHeaders('a,b,c')).toEqual(['a', 'b', 'c']);
	});

	test('a quoted header with a comma stays one header', () => {
		expect(parseCsvHeaders('Date,"Cost, USD",Notes')).toEqual(['Date', 'Cost, USD', 'Notes']);
	});
});

describe('splitCsvLine', () => {
	test('keeps a comma inside quotes in its cell', () => {
		expect(splitCsvLine('2025-03-14,"Costco, Mountain View",37.05')).toEqual([
			'2025-03-14',
			'Costco, Mountain View',
			'37.05'
		]);
	});

	test('reads a doubled quote as one quote, and keeps empty cells', () => {
		expect(splitCsvLine('"He said ""hi""",,x')).toEqual(['He said "hi"', '', 'x']);
	});
});

describe('isNativeImportHeaders', () => {
	test('the native export shape (date/vehicle/category/amount, any case + extras) is native', () => {
		expect(
			isNativeImportHeaders(['Date', 'Vehicle', 'Category', 'Amount', 'mileage', 'tags'])
		).toBe(true);
		expect(isNativeImportHeaders(['date', 'vehicle', 'category', 'amount'])).toBe(true);
	});

	test('a file MISSING any native column is not native (→ manual mapping)', () => {
		expect(isNativeImportHeaders(['date', 'vehicle', 'amount'])).toBe(false);
		expect(isNativeImportHeaders(['Transaction Date', 'Spent', 'Kind'])).toBe(false);
		expect(isNativeImportHeaders([])).toBe(false);
	});
});

describe('guessManualColumns', () => {
	test('maps the obvious VROOM fields by header-name substring (case-insensitive, first match)', () => {
		const guess = guessManualColumns([
			'Date',
			'Vehicle',
			'Category',
			'Amount',
			'Odometer',
			'Volume',
			'Notes'
		]);
		expect(guess).toEqual({
			date: 'Date',
			vehicle: 'Vehicle',
			category: 'Category',
			amount: 'Amount',
			mileage: 'Odometer',
			volume: 'Volume',
			description: 'Notes'
		});
	});

	test('generous header needles map spent/paid/total to amount and kind to category', () => {
		expect(guessManualColumns(['Transaction Date', 'Spent', 'Kind', 'Notes'])).toEqual({
			date: 'Transaction Date',
			amount: 'Spent',
			category: 'Kind',
			description: 'Notes'
		});
		expect(guessManualColumns(['When', 'Total Paid'])['amount']).toBe('Total Paid');
	});

	test('metric volume needles (litre/liter/gallon/fill) + odo map onto fuel-log headers', () => {
		const guess = guessManualColumns(['Odo (km)', 'Fuel (litres)', 'Fill Amount']);
		expect(guess.mileage).toBe('Odo (km)');
		expect(guess.volume).toBe('Fuel (litres)');
	});

	test('each header is guessed for at most one field', () => {
		expect(guessManualColumns(['Date', 'Odometer', 'Fill Amount', 'Total Cost'])).toEqual({
			date: 'Date',
			mileage: 'Odometer',
			volume: 'Fill Amount',
			amount: 'Total Cost'
		});
		for (const headers of [
			['Date', 'Odometer', 'Fill Amount', 'Total Cost'],
			['Date', 'Odometer', 'Fuel Type', 'Price per gallon', 'Total'],
			['Date', 'Payment card', 'Amount', 'Gallons', 'Total']
		]) {
			const fields = Object.values(guessManualColumns(headers));
			expect(new Set(fields).size).toBe(fields.length);
		}
	});

	test('a unit price, a fuel type or a payment card is not taken for amount, category or vehicle', () => {
		const guess = guessManualColumns(['Date', 'Fuel Type', 'Price per gallon', 'Total']);
		expect(guess.amount).toBe('Total');
		expect(guess.volume).toBeUndefined();
		expect(guess.category).toBeUndefined();
		expect(guessManualColumns(['Date', 'Payment card', 'Amount']).vehicle).toBeUndefined();
		expect(guessManualColumns(['Date', 'Car', 'Type', 'Amount'])).toMatchObject({
			vehicle: 'Car',
			category: 'Type'
		});
	});

	test('a volume total is volume, a distance total is never the amount, and entry or service types are categories', () => {
		expect(
			guessManualColumns(['Date', 'Total gallons', 'Total distance', 'Price', 'Service type'])
		).toEqual({
			date: 'Date',
			volume: 'Total gallons',
			amount: 'Price',
			category: 'Service type'
		});
		expect(guessManualColumns(['Date', 'Entry type', 'Payment type', 'Amount']).category).toBe(
			'Entry type'
		);
		for (const header of ['Vehicle type', 'Car type', 'Gas type', 'Oil type', 'Charger type']) {
			expect(guessManualColumns(['Date', header, 'Amount']).category).toBeUndefined();
		}
	});

	test('an un-guessable header set leaves fields unmapped (no invented columns)', () => {
		expect(guessManualColumns(['col1', 'col2', 'xyz'])).toEqual({});
	});
});

describe('presetImportMapping', () => {
	const preset: DetectedImportFormat = {
		id: 'fuelly',
		label: 'Fuelly'
	};

	test('sends only the format id, the target vehicle and the user remap; the server owns the columns', () => {
		const mapping = presetImportMapping(preset, 'My Car', { gas: 'misc', wash: 'maintenance' });
		expect(mapping).toEqual({
			source: 'fuelly',
			columns: {},
			targetVehicle: 'My Car',
			dateFormat: 'iso',
			categoryMap: { gas: 'misc', wash: 'maintenance' }
		});
	});
});
