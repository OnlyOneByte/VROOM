import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ImportColumnMapping } from '$lib/types';
import type { ExpenseImportResult } from '../expense-api';

const post = vi.fn();
vi.mock('../api-client', () => ({
	apiClient: { post },
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
		expect(result.unmappedCategories).toEqual(['carwash']);
	});
});
