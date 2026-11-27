import type { ExpenseCategory, ImportColumnMapping, NativeImportField } from '#lib/types/index.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';

export const NATIVE_HEADERS = ['date', 'vehicle', 'category', 'amount'] as const;

export const DETECT_SAMPLE_LENGTH = 8192;

export function splitCsvLine(line: string): string[] {
	const cells: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted && ch === '"' && line[i + 1] === '"') {
			cell += '"';
			i++;
		} else if (ch === '"') {
			quoted = !quoted;
		} else if (ch === ',' && !quoted) {
			cells.push(cell.trim());
			cell = '';
		} else {
			cell += ch;
		}
	}
	cells.push(cell.trim());
	return cells;
}

export function parseCsvHeaders(csvText: string): string[] {
	const firstLine = csvText.split('\n', 1)[0]?.trim();
	if (!firstLine) return [];
	return splitCsvLine(firstLine);
}

export function isNativeImportHeaders(headers: string[]): boolean {
	const lower = new Set(headers.map(h => h.toLowerCase()));
	return NATIVE_HEADERS.every(h => lower.has(h));
}

export function guessManualColumns(headers: string[]): Partial<Record<NativeImportField, string>> {
	const guess: Partial<Record<NativeImportField, string>> = {};
	const find = (...needles: string[]) =>
		headers.find(h => needles.some(n => h.toLowerCase().includes(n)));
	const set = (field: NativeImportField, ...needles: string[]) => {
		const m = find(...needles);
		if (m) guess[field] = m;
	};
	set('date', 'date');
	set('amount', 'amount', 'price', 'cost', 'spent', 'paid', 'total');
	set('category', 'category', 'type', 'kind');
	set('vehicle', 'vehicle', 'car');
	set('mileage', 'odometer', 'mileage', 'odo');
	set('volume', 'volume', 'gallon', 'litre', 'liter', 'fuel amount', 'fill');
	set('description', 'note', 'description', 'comment');
	set('tags', 'tag');
	return guess;
}

export function presetImportMapping(
	format: DetectedImportFormat,
	targetVehicle: string,
	categoryRemap: Record<string, ExpenseCategory>
): ImportColumnMapping {
	return {
		source: format.id,
		columns: {},
		targetVehicle,
		dateFormat: 'iso',
		categoryMap: categoryRemap
	};
}
