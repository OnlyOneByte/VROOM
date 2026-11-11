import type { NativeImportField } from '$lib/types';

const NATIVE_HEADERS = ['date', 'vehicle', 'category', 'amount'] as const;

export function parseCsvHeaders(csvText: string): string[] {
	const firstLine = csvText.split('\n', 1)[0]?.trim();
	if (!firstLine) return [];
	return firstLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
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
