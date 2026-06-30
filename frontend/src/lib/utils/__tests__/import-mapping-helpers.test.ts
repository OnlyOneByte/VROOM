/**
 * Unit guard (C38) for the import-trackers manual-mapping pure helpers, extracted C38 from
 * ImportExpensesDialog.svelte (vitest can't reach functions defined inside a `.svelte` <script>, so the
 * C37 manual-mapping logic was unpinned). These pin: header parsing (quotes/whitespace), the
 * native-export detection that gates the manual editor, and the auto-guess needle sets (incl. the C37
 * eyes-on additions spent/paid/total→amount, kind→category that a bespoke export needed to preview).
 */

import { describe, expect, test } from 'vitest';
import type { ImportMappingPreset } from '$lib/types';
import {
	buildPresetMapping,
	guessManualColumns,
	isNativeImportHeaders,
	parseCsvHeaders
} from '$lib/utils/import-mapping-helpers';

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
});

describe('isNativeImportHeaders', () => {
	test('the native export shape (date/vehicle/category/amount, any case + extras) is native', () => {
		expect(
			isNativeImportHeaders(['Date', 'Vehicle', 'Category', 'Amount', 'mileage', 'tags'])
		).toBe(true);
		expect(isNativeImportHeaders(['date', 'vehicle', 'category', 'amount'])).toBe(true);
	});

	test('a file MISSING any native column is not native (→ manual mapping)', () => {
		// No 'category' column.
		expect(isNativeImportHeaders(['date', 'vehicle', 'amount'])).toBe(false);
		// A bespoke foreign file.
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

	test('the C37 generous needles: spent/paid/total→amount, kind→type→category', () => {
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
		// First volume match wins (litres before "Fill Amount").
		expect(guess.volume).toBe('Fuel (litres)');
	});

	test('an un-guessable header set leaves fields unmapped (no invented columns)', () => {
		expect(guessManualColumns(['col1', 'col2', 'xyz'])).toEqual({});
	});
});

describe('buildPresetMapping (C153 — the dialog sends a detected preset, incl. defaultCategory)', () => {
	// A Fuelly-shaped preset: NO category column, defaultCategory 'fuel' (the #C148 fix). The dialog must
	// forward defaultCategory so a detected fuel log previews ready fuel rows, not 0-ready "Unknown category".
	const fuelly: ImportMappingPreset = {
		id: 'fuelly',
		label: 'Fuelly',
		signature: ['odometer', 'fillamount'],
		columns: { date: 'Date', mileage: 'Odometer', volume: 'Fill Amount', amount: 'Price' },
		dateFormat: 'mdy',
		distanceUnit: 'miles',
		volumeUnit: 'gallons_us',
		categoryMap: { gas: 'fuel' },
		defaultCategory: 'fuel'
	};

	test('carries the preset defaultCategory through (the #C148 passthrough — load-bearing)', () => {
		const mapping = buildPresetMapping(fuelly, 'Daily Driver', {});
		// THE guard: dropping this field silently reverts the feature at the UI layer (detected fuel log
		// → 0-ready) even with the backend fix in place.
		expect(mapping.defaultCategory).toBe('fuel');
		expect(mapping.source).toBe('fuelly');
		expect(mapping.targetVehicle).toBe('Daily Driver');
		expect(mapping.columns).toEqual(fuelly.columns);
		expect(mapping.dateFormat).toBe('mdy');
		expect(mapping.distanceUnit).toBe('miles');
		expect(mapping.volumeUnit).toBe('gallons_us');
	});

	test('the user remap overrides the preset categoryMap (user choices win)', () => {
		const mapping = buildPresetMapping(fuelly, 'Daily Driver', { gas: 'maintenance' });
		expect(mapping.categoryMap).toEqual({ gas: 'maintenance' }); // user's 'maintenance' beats preset 'fuel'
		expect(mapping.defaultCategory).toBe('fuel'); // default still carried
	});

	test('a preset WITHOUT a defaultCategory yields an undefined one (no invented default)', () => {
		const noDefault: ImportMappingPreset = { ...fuelly, defaultCategory: undefined };
		expect(buildPresetMapping(noDefault, 'Daily Driver', {}).defaultCategory).toBeUndefined();
	});
});
