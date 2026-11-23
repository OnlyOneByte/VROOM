import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ImportColumnMapping } from '#lib/types/index.ts';
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
	test("sends the browser time zone so date-only rows land on the user's calendar day", async () => {
		post.mockResolvedValueOnce(NATIVE_RESULT);
		const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
			...new Intl.DateTimeFormat().resolvedOptions(),
			timeZone: 'Pacific/Kiritimati'
		});
		try {
			await expenseApi.importExpensesCsv('csv-text', true);
		} finally {
			spy.mockRestore();
		}
		const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(body['timeZone']).toBe('Pacific/Kiritimati');
	});

	test('native path sends csv, dryRun and the browser time zone — no mapping key', async () => {
		post.mockResolvedValueOnce(NATIVE_RESULT);
		await expenseApi.importExpensesCsv('date,vehicle\n2024-01-01,Civic', true);

		expect(post).toHaveBeenCalledTimes(1);
		const [url, body] = post.mock.calls[0] ?? [];
		expect(url).toBe('/expenses/import');
		expect(body).toEqual({
			csv: 'date,vehicle\n2024-01-01,Civic',
			dryRun: true,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
		});
		expect('mapping' in (body as object)).toBe(false);
	});

	test('dryRun defaults to false when omitted', async () => {
		post.mockResolvedValueOnce({ ...NATIVE_RESULT, dryRun: false, imported: 2 });
		await expenseApi.importExpensesCsv('csv-text');
		const [, body] = post.mock.calls[0] ?? [];
		expect(body).toEqual({
			csv: 'csv-text',
			dryRun: false,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
		});
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
		expect(url).toBe('/expenses/import');
		expect(body).toEqual({
			csv: 'Date,Cost,Car\n…',
			dryRun: true,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			mapping
		});
		expect(result.unmappedCategories).toEqual(['carwash']);
	});
});
