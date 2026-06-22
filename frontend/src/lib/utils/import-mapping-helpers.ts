import type { NativeImportField } from '$lib/types';

/**
 * Pure helpers for the import-trackers manual-mapping dialog (T4, extracted C38 from
 * ImportExpensesDialog.svelte so they're unit-testable — vitest can't reach functions defined inside a
 * `.svelte` <script>). No Svelte/DOM deps. The dialog wires these to its state + the preview/commit flow.
 */

/** The four native-export header names — a file carrying all of them imports directly, no mapping. */
const NATIVE_HEADERS = ['date', 'vehicle', 'category', 'amount'] as const;

/**
 * Split a CSV's header row (its FIRST line) into trimmed, de-quoted column names. Delimiter-`,` only —
 * the server does the authoritative parse; this is just enough to drive detection + the mapping dropdowns.
 * Returns [] for empty/blank input.
 */
export function parseCsvHeaders(csvText: string): string[] {
	const firstLine = csvText.split('\n', 1)[0]?.trim();
	if (!firstLine) return [];
	return firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
}

/**
 * Whether the headers are already VROOM's native export shape (case-insensitive superset of
 * date/vehicle/category/amount). A native file imports with NO mapping (the unchanged path); only a
 * NON-native, preset-unmatched file gets the manual-mapping editor.
 */
export function isNativeImportHeaders(headers: string[]): boolean {
	const lower = new Set(headers.map((h) => h.toLowerCase()));
	return NATIVE_HEADERS.every((h) => lower.has(h));
}

/**
 * Best-effort initial guess for the manual column editor: map each VROOM field to the FIRST header whose
 * name contains a known needle (case-insensitive substring). The user adjusts any wrong guess via the
 * dropdowns; an un-guessable field stays unmapped (the field is simply absent from the result). The
 * needle sets are deliberately generous (e.g. amount also matches spent/paid/total; category also kind)
 * so common third-party exports land their date+amount automatically and preview without manual edits.
 */
export function guessManualColumns(headers: string[]): Partial<Record<NativeImportField, string>> {
	const guess: Partial<Record<NativeImportField, string>> = {};
	const find = (...needles: string[]) =>
		headers.find((h) => needles.some((n) => h.toLowerCase().includes(n)));
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
