import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import ImportPreviewSummary from '../ImportPreviewSummary.svelte';

type Props = {
	isPreviewing: boolean;
	preview: ExpenseImportResult | null;
	errorRows: ExpenseImportResult['rows'];
	needsTargetVehicle: boolean;
	needsManualMapping: boolean;
	hasCsv: boolean;
};

const IDLE: Props = {
	isPreviewing: false,
	preview: null,
	errorRows: [],
	needsTargetVehicle: false,
	needsManualMapping: false,
	hasCsv: false
};

function preview(readyCount: number, errorCount: number): ExpenseImportResult {
	return {
		dryRun: true,
		imported: 0,
		readyCount,
		errorCount,
		totalRows: readyCount + errorCount,
		rows: []
	};
}

function text(container: HTMLElement): string {
	return container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('ImportPreviewSummary', () => {
	test('renders nothing with no CSV and nothing pending', () => {
		const { container } = render(ImportPreviewSummary, IDLE);

		expect(text(container)).toBe('');
	});

	test('shows a spinner message while the first preview loads', () => {
		const { container } = render(ImportPreviewSummary, { ...IDLE, isPreviewing: true });

		expect(text(container)).toBe('Checking your file…');
	});

	test('keeps the previous preview on screen, marked as updating, while a new one loads', () => {
		const { container } = render(ImportPreviewSummary, {
			...IDLE,
			isPreviewing: true,
			preview: preview(3, 0)
		});

		expect(text(container)).toContain('3 ready');
		expect(text(container)).toContain('Updating…');
		expect(text(container)).not.toContain('Checking your file…');
	});

	test('a clean preview shows only the ready count', () => {
		const { container } = render(ImportPreviewSummary, { ...IDLE, preview: preview(5, 0) });

		expect(text(container)).toBe('5 ready');
	});

	test('a single error uses singular wording and explains skipped rows', () => {
		const { container } = render(ImportPreviewSummary, {
			...IDLE,
			preview: preview(1, 1),
			errorRows: [{ row: 3, status: 'error', message: 'Amount is not a number' }]
		});

		expect(text(container)).toContain('1 row needs attention');
		expect(text(container)).toContain('Row 3 Amount is not a number');
		expect(text(container)).toContain('only the 1 ready row will be imported.');
	});

	test('multiple errors use plural wording', () => {
		const { container } = render(ImportPreviewSummary, {
			...IDLE,
			preview: preview(4, 2),
			errorRows: [
				{ row: 2, status: 'error', message: 'Missing date' },
				{ row: 7, status: 'error', message: 'Unknown vehicle' }
			]
		});

		expect(text(container)).toContain('2 rows need attention');
		expect(screen.getByText('Row 2')).toBeInTheDocument();
		expect(screen.getByText('Unknown vehicle')).toBeInTheDocument();
		expect(text(container)).toContain('only the 4 ready rows will be imported.');
	});

	test('no skipped-rows note when every row failed', () => {
		const { container } = render(ImportPreviewSummary, { ...IDLE, preview: preview(0, 2) });

		expect(text(container)).toContain('0 ready');
		expect(text(container)).not.toContain('will be imported');
	});

	test('asks for a vehicle before previewing', () => {
		const { container } = render(ImportPreviewSummary, {
			...IDLE,
			needsTargetVehicle: true,
			needsManualMapping: true,
			hasCsv: true
		});

		expect(text(container)).toBe('Choose a vehicle above to preview the import.');
	});

	test('asks for a column mapping before previewing', () => {
		const { container } = render(ImportPreviewSummary, {
			...IDLE,
			needsManualMapping: true,
			hasCsv: true
		});

		expect(text(container)).toBe('Map Date, Amount, and a vehicle above to preview the import.');
	});

	test('prompts to blur the paste box when CSV is present but not previewed', () => {
		const { container } = render(ImportPreviewSummary, { ...IDLE, hasCsv: true });

		expect(text(container)).toBe('Click outside the box to preview.');
	});

	test('shows the currency warning from the preview as a polite status', () => {
		const warning = 'This file is in EUR; amounts will be imported as JPY without conversion.';
		render(ImportPreviewSummary, {
			...IDLE,
			preview: { ...preview(9, 0), currencyWarning: warning }
		});

		const alert = screen.getByTestId('import-currency-warning');
		expect(alert.getAttribute('role')).toBe('status');
		expect(alert.textContent?.trim()).toBe(warning);
	});

	test('shows no currency warning when the preview has none', () => {
		render(ImportPreviewSummary, { ...IDLE, preview: preview(9, 0) });

		expect(screen.queryByTestId('import-currency-warning')).toBeNull();
	});
});
