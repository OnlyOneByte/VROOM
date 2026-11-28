import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ImportCsvSource from '../ImportCsvSource.svelte';

function renderSource(
	fileName: string | null = null,
	csvText = '',
	accept: string[] | undefined = ['.csv', 'text/csv']
) {
	const onFileChange = vi.fn();
	const onPasteBlur = vi.fn();
	render(ImportCsvSource, { csvText, fileName, accept, onFileChange, onPasteBlur });
	return { onFileChange, onPasteBlur };
}

function fileInput(): HTMLInputElement {
	return document.getElementById('import-csv-file') as HTMLInputElement;
}

describe('ImportCsvSource', () => {
	test('invites choosing a file until one is loaded', () => {
		renderSource();

		expect(screen.getByText('Choose a .csv file')).toBeInTheDocument();
	});

	test('shows the loaded file name', () => {
		renderSource('fuel-log.csv');

		expect(screen.getByText('fuel-log.csv')).toBeInTheDocument();
		expect(screen.queryByText('Choose a .csv file')).toBeNull();
	});

	test('accepts the file types the server lists', () => {
		renderSource();

		expect(fileInput().accept).toBe('.csv,text/csv');
	});

	test('names every extension the server accepts', () => {
		renderSource(null, '', ['.csv', 'text/csv', '.json']);

		expect(screen.getByText('Choose a .csv or .json file')).toBeInTheDocument();
		expect(fileInput().accept).toBe('.csv,text/csv,.json');
	});

	test('before the list arrives, any file can be chosen', () => {
		render(ImportCsvSource, {
			csvText: '',
			fileName: null,
			onFileChange: vi.fn(),
			onPasteBlur: vi.fn()
		});

		expect(screen.getByText('Choose a file')).toBeInTheDocument();
		expect(fileInput().accept).toBe('');
	});

	test('passes the chosen file on', async () => {
		const { onFileChange } = renderSource();
		const file = new File(['date,amount'], 'log.csv', { type: 'text/csv' });
		Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true });

		await fireEvent.change(fileInput());

		expect(onFileChange).toHaveBeenCalledWith(file);
	});

	test('clears the chosen file so choosing the same file again fires a new change', async () => {
		const { onFileChange } = renderSource();
		const file = new File(['date,amount'], 'log.csv', { type: 'text/csv' });
		const cleared = vi.fn();
		Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true });
		Object.defineProperty(fileInput(), 'value', {
			get: () => 'C:\\fakepath\\log.csv',
			set: cleared,
			configurable: true
		});

		await fireEvent.change(fileInput());

		expect(onFileChange).toHaveBeenCalledWith(file);
		expect(cleared).toHaveBeenCalledWith('');
	});

	test('ignores a change with no file selected', async () => {
		const { onFileChange } = renderSource();
		Object.defineProperty(fileInput(), 'files', { value: [], configurable: true });

		await fireEvent.change(fileInput());

		expect(onFileChange).not.toHaveBeenCalled();
	});

	test('shows pasted CSV text and reports when the paste box loses focus', async () => {
		const { onPasteBlur } = renderSource(null, 'date,amount\n2026-01-01,5');
		const textarea = screen.getByLabelText('Or paste CSV') as HTMLTextAreaElement;

		expect(textarea.value).toBe('date,amount\n2026-01-01,5');

		await fireEvent.input(textarea, { target: { value: 'date,cost' } });
		await fireEvent.blur(textarea);

		expect(textarea.value).toBe('date,cost');
		expect(onPasteBlur).toHaveBeenCalledTimes(1);
	});
});
