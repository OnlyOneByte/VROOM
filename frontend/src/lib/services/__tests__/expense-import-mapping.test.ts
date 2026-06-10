/**
 * Coverage (C140, import-trackers T4/T5 FE client slice) for the foreign-tracker import methods on
 * expenseApi — the client surface the eyes-on mapping dialog consumes. The backend route already
 * accepts `mapping` (POST /import, T3/C70) and exposes detection (POST /import/detect), but the FE
 * client only sent `{csv, dryRun}` and had no detect method (the C134-class gap). These pin:
 *  - the native path request is UNCHANGED (no `mapping` key) — backward-compat,
 *  - a foreign import threads the mapping through verbatim,
 *  - detect posts only the header names and passes a preset (or null) through.
 *
 * apiClient is mocked (the analytics-api.test.ts pattern) so we assert the exact URL + body the
 * client builds — apiClient.post already unwraps the {success,data} envelope.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ImportColumnMapping, ImportMappingPreset } from '$lib/types';
import type { ExpenseImportResult } from '../expense-api';

const post = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { post },
	// expense-api.ts also imports these from api-client at module load — stub them harmlessly.
	getApiBaseUrl: () => '',
	withPagination: (path: string) => path
}));

const { expenseApi } = await import('../expense-api');

const NATIVE_RESULT: ExpenseImportResult = {
	dryRun: true,
	imported: 0,
	readyCount: 2,
	errorCount: 0,
	totalRows: 2,
	rows: []
};

beforeEach(() => {
	post.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('expenseApi.importExpensesCsv', () => {
	test('native path sends ONLY {csv, dryRun} — no mapping key (backward-compatible)', async () => {
		post.mockResolvedValueOnce(NATIVE_RESULT);
		await expenseApi.importExpensesCsv('date,vehicle\n2024-01-01,Civic', true);

		expect(post).toHaveBeenCalledTimes(1);
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/expenses/import');
		expect(body).toEqual({ csv: 'date,vehicle\n2024-01-01,Civic', dryRun: true });
		// The exact-equality above already proves it, but pin the load-bearing absence explicitly:
		expect('mapping' in (body as object)).toBe(false);
	});

	test('dryRun defaults to false when omitted', async () => {
		post.mockResolvedValueOnce({ ...NATIVE_RESULT, dryRun: false, imported: 2 });
		await expenseApi.importExpensesCsv('csv-text');
		const [, body] = post.mock.calls[0] ?? [];
		expect(body).toEqual({ csv: 'csv-text', dryRun: false });
	});

	test('foreign-tracker path threads the mapping through verbatim and returns unmappedCategories', async () => {
		const mapping: ImportColumnMapping = {
			source: 'fuelly',
			columns: { date: 'Date', amount: 'Cost', vehicle: 'Car' },
			targetVehicle: 'Civic',
			dateFormat: 'mdy',
			distanceUnit: 'miles',
			volumeUnit: 'gallons_us',
			categoryMap: { gas: 'fuel' }
		};
		post.mockResolvedValueOnce({ ...NATIVE_RESULT, unmappedCategories: ['carwash'] });

		const result = await expenseApi.importExpensesCsv('Date,Cost,Car\n…', true, mapping);

		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/expenses/import');
		expect(body).toEqual({ csv: 'Date,Cost,Car\n…', dryRun: true, mapping });
		// The dialog reads unmappedCategories to prompt the user to remap (D2).
		expect(result.unmappedCategories).toEqual(['carwash']);
	});
});

describe('expenseApi.detectImportSource', () => {
	test('posts only the header names and passes a matched preset through', async () => {
		const preset: ImportMappingPreset = {
			id: 'fuelly',
			label: 'Fuelly',
			signature: ['mpg', 'odometer'],
			columns: { date: 'Date', amount: 'Cost' },
			dateFormat: 'mdy'
		};
		post.mockResolvedValueOnce(preset);

		const headers = ['Date', 'Cost', 'MPG', 'Odometer'];
		const result = await expenseApi.detectImportSource(headers);

		expect(post).toHaveBeenCalledWith('/api/v1/expenses/import/detect', { headers });
		expect(result).toEqual(preset);
	});

	test('passes a null (unrecognized file → manual mapping) through unchanged', async () => {
		post.mockResolvedValueOnce(null);
		const result = await expenseApi.detectImportSource(['Foo', 'Bar']);
		expect(result).toBeNull();
	});
});
