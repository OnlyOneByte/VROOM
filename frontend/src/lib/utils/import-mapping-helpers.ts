import type { ExpenseCategory, ImportColumnMapping, NativeImportField } from '#lib/types/index.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';

export const NATIVE_HEADERS = ['date', 'vehicle', 'category', 'amount'] as const;

export const DETECT_SAMPLE_LENGTH = 8192;

const DELIMITERS = [',', ';', '\t'] as const;

/** The delimiter used most often outside quotes on the first non-empty line; a comma on a tie. */
export function csvDelimiter(csvText: string): string {
	const line = csvText.split(/\r?\n/).find(l => l.trim() !== '') ?? '';
	const counts = new Map<string, number>();
	let quoted = false;
	for (const ch of line) {
		if (ch === '"') quoted = !quoted;
		else if (!quoted) counts.set(ch, (counts.get(ch) ?? 0) + 1);
	}
	return DELIMITERS.reduce<string>(
		(best, d) => ((counts.get(d) ?? 0) > (counts.get(best) ?? 0) ? d : best),
		','
	);
}

export function splitCsvLine(line: string, delimiter = ','): string[] {
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
		} else if (ch === delimiter && !quoted) {
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
	return splitCsvLine(firstLine, csvDelimiter(firstLine));
}

export function isNativeImportHeaders(headers: string[]): boolean {
	const lower = new Set(headers.map(h => h.toLowerCase()));
	return NATIVE_HEADERS.every(h => lower.has(h));
}

const UNIT_PRICE = /\bper\b|\/\s*(gal|l|litre|liter)\b|unit price/;

const GUESSES: Array<[NativeImportField, Array<RegExp>, RegExp?]> = [
	['date', [/date/]],
	['mileage', [/odometer/, /mileage/, /\bodo\b/]],
	['volume', [/volume/, /gallon/, /litre|liter/, /fuel amount/, /\bfill/], /price|cost|paid|spent/],
	[
		'amount',
		[/^(total|amount)$/, /total/, /amount/, /cost/, /spent/, /paid/, /price/],
		/volume|gallon|litre|liter|fill|distance|mileage|odometer|\bkm\b|\bmiles?\b/
	],
	[
		'category',
		[/categor/, /\btype\b/, /\bkind\b/],
		/fuel|gas|oil|payment|vehicle|\bcar\b|charger|plug/
	],
	['vehicle', [/vehicle/, /\bcar\b/], /\btype\b/],
	['description', [/note/, /description/, /comment/]],
	['tags', [/\btags?\b/]]
];

function headerWords(header: string): string {
	return header
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_\-.]+/g, ' ')
		.toLowerCase();
}

export function guessManualColumns(headers: string[]): Partial<Record<NativeImportField, string>> {
	const guess: Partial<Record<NativeImportField, string>> = {};
	const claimed = new Set<string>();
	for (const [field, needles, exclude] of GUESSES) {
		const open = headers.filter(h => !claimed.has(h) && !exclude?.test(headerWords(h)));
		const ranked =
			field === 'amount' ? [...open].sort((a, b) => unitPriceRank(a) - unitPriceRank(b)) : open;
		const match = needles
			.map(needle => ranked.find(h => needle.test(headerWords(h))))
			.find(Boolean);
		if (match) {
			guess[field] = match;
			claimed.add(match);
		}
	}
	return guess;
}

function unitPriceRank(header: string): number {
	return UNIT_PRICE.test(headerWords(header)) ? 1 : 0;
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
