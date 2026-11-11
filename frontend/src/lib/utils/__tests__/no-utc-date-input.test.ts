import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { formatDate } from '$lib/utils/formatters';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const UTC_DATE_INPUT =
	/\.toISOString\(\)\s*\.\s*(?:split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\]|slice\(\s*0\s*,\s*10\s*\))/g;

const ISO_STRING_DATE_SLICE =
	/\.(?:startDate|endDate|dueDate|nextDueDate|purchaseDate|serviceDate|paymentDate|claimDate)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\])/g;

const DATE_ONLY_FORM_VALUE = String.raw`(?:\w*[Ff]orm\w*\s*(?:\.\s*\w+|\[\s*['"\`]\w+['"\`]\s*\])|(?:start|end|due|trip|service|claim|purchase)Date\b)`;

const LOCAL_CALENDAR_READ = String.raw`(?:toLocale(?:Date|Time)?String|getDate|getMonth|getFullYear|getDay)`;

const DATE_FORMATTER = String.raw`(?:formatDate|formatDateTick|formatRelativeTime)`;

const UTC_PARSE_OF_DATE_ONLY = new RegExp(
	String.raw`new Date\(\s*${DATE_ONLY_FORM_VALUE}[^)]*\)\s*\.\s*${LOCAL_CALENDAR_READ}` +
		String.raw`|${DATE_FORMATTER}\(\s*(?:new Date\(\s*)?${DATE_ONLY_FORM_VALUE}`,
	'g'
);

const PERSISTED_DATE_KEY = String.raw`(?:date|startDate|endDate|dueDate|nextDueDate|tripDate|claimDate|purchaseDate|paymentDate|serviceDate|recordedAt)`;

const RAW_DATE_ONLY_PERSISTED = new RegExp(
	String.raw`\b${PERSISTED_DATE_KEY}\s*:\s*${DATE_ONLY_FORM_VALUE}\s*(?=[,}\n])`,
	'g'
);

function stripComments(source: string): string {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
	return withoutBlocks
		.split('\n')
		.map(line => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('*')) return '';
			const idx = line.indexOf('//');
			if (idx === -1) return line;
			if (idx > 0 && line[idx - 1] === ':') return line;
			return line.slice(0, idx);
		})
		.join('\n');
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === 'node_modules' ||
				entry.name === '.svelte-kit' ||
				entry.name === '__tests__'
			)
				continue;
			collectSourceFiles(full, acc);
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

const files = collectSourceFiles(SRC_ROOT);

function scanSources(pattern: RegExp): string[] {
	const offenders: string[] = [];
	for (const file of files) {
		const rel = relative(SRC_ROOT, file).split('\\').join('/');
		const text = stripComments(readFileSync(file, 'utf8'));
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			const line = text.slice(0, match.index).split('\n').length;
			offenders.push(`${rel}:${line}  ${match[0].replace(/\s+/g, ' ')}`);
		}
	}
	return offenders;
}

function matches(pattern: RegExp, sample: string): boolean {
	pattern.lastIndex = 0;
	return pattern.test(sample);
}

describe('date-only values never cross the UTC calendar (class guards)', () => {
	test('the scan actually found sources (guards are live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test('no source builds a date-input value via new Date(x).toISOString().split/slice', () => {
		const offenders = scanSources(UTC_DATE_INPUT);
		expect(
			offenders,
			`Date-input value built from the UTC calendar date — use toDateInputValue() from ` +
				`formatters.ts (local getFullYear/getMonth/getDate) so the date is correct in every ` +
				`timezone and round-trips with dateOnlyToISO:\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('no source slices a stored ISO date-field STRING to its first 10 chars for a date input', () => {
		const offenders = scanSources(ISO_STRING_DATE_SLICE);
		expect(
			offenders,
			`A stored ISO date-field string sliced to [0, 10) feeds the UTC calendar date to a date ` +
				`input — use toDateInputValue(new Date(field)) so the local date round-trips with ` +
				`dateOnlyToISO in every timezone:\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('no source reads a date-only form value on the local calendar after new Date() parsed it', () => {
		const offenders = scanSources(UTC_PARSE_OF_DATE_ONLY);
		expect(
			offenders,
			`A date-only value ('YYYY-MM-DD') parsed with new Date() is midnight UTC, so any LOCAL ` +
				`read of it (toLocaleDateString / getDate / a date formatter) renders the PREVIOUS day ` +
				`for Americas users — and an empty picker value throws instead of rendering. Pass it ` +
				`through the named parse: formatDate(dateOnlyToISO(value)):\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('no source persists a date-only form value raw', () => {
		const offenders = scanSources(RAW_DATE_ONLY_PERSISTED);
		expect(
			offenders,
			`A date-only value ('YYYY-MM-DD') sent to the API is parsed as midnight UTC by the ` +
				`backend, so it stores (and reads back) a day early for every negative-offset user — ` +
				`persist dateOnlyToISO(value), the noon-local instant every other form sends:` +
				`\n${offenders.join('\n')}`
		).toEqual([]);
	});

	describe('the patterns detect the class, not one byte-shape', () => {
		test.each([
			{ pattern: UTC_DATE_INPUT, sample: "new Date(x).toISOString().split('T')[0]" },
			{ pattern: UTC_DATE_INPUT, sample: 'new Date(x).toISOString().slice(0, 10)' },
			{ pattern: ISO_STRING_DATE_SLICE, sample: 'term.startDate.slice(0, 10)' },
			{ pattern: ISO_STRING_DATE_SLICE, sample: "term.startDate.split('T')[0]" },
			{
				pattern: UTC_PARSE_OF_DATE_ONLY,
				sample: "new Date(formData.date || '').toLocaleDateString()"
			},
			{ pattern: UTC_PARSE_OF_DATE_ONLY, sample: 'formatDate(formData.date)' },
			{ pattern: UTC_PARSE_OF_DATE_ONLY, sample: 'formatDate(new Date(formData.date))' },
			{ pattern: UTC_PARSE_OF_DATE_ONLY, sample: 'new Date(claimDate).getDate()' },
			{ pattern: RAW_DATE_ONLY_PERSISTED, sample: 'date: formData.date,' },
			{ pattern: RAW_DATE_ONLY_PERSISTED, sample: 'startDate: startDate,' },
			{ pattern: RAW_DATE_ONLY_PERSISTED, sample: 'tripDate: tripDate }' }
		])('flags `$sample`', ({ pattern, sample }) => {
			expect(matches(pattern, sample)).toBe(true);
		});

		test.each([
			{ pattern: UTC_DATE_INPUT, sample: 'toDateInputValue(new Date(expense.date))' },
			{ pattern: ISO_STRING_DATE_SLICE, sample: 'toDateInputValue(new Date(term.startDate))' },
			{ pattern: UTC_PARSE_OF_DATE_ONLY, sample: 'formatDate(dateOnlyToISO(formData.date))' },
			{ pattern: UTC_PARSE_OF_DATE_ONLY, sample: 'formatDate(new Date(originalExpense.date))' },
			{ pattern: UTC_PARSE_OF_DATE_ONLY, sample: 'new Date(endDate) <= new Date(startDate)' },
			{ pattern: RAW_DATE_ONLY_PERSISTED, sample: 'date: dateOnlyToISO(formData.date),' },
			{
				pattern: RAW_DATE_ONLY_PERSISTED,
				sample: 'endDate: endDate ? dateOnlyToISO(endDate) : null,'
			},
			{ pattern: RAW_DATE_ONLY_PERSISTED, sample: 'date: toDateInputValue(new Date()),' }
		])('leaves `$sample` alone', ({ pattern, sample }) => {
			expect(matches(pattern, sample)).toBe(false);
		});
	});
});

describe('formatDate renders a date-only value as its own calendar day in every timezone', () => {
	function withTimeZone<T>(zone: string, read: () => T): T {
		const previous = process.env['TZ'];
		process.env['TZ'] = zone;
		try {
			return read();
		} finally {
			if (previous === undefined) delete process.env['TZ'];
			else process.env['TZ'] = previous;
		}
	}

	test.each(['America/Los_Angeles', 'America/New_York', 'UTC', 'Pacific/Kiritimati'])(
		'%s',
		zone => {
			expect(withTimeZone(zone, () => formatDate('2024-03-15'))).toBe('Mar 15, 2024');
			expect(withTimeZone(zone, () => formatDate('2024-01-01'))).toBe('Jan 1, 2024');
			expect(withTimeZone(zone, () => formatDate('2024-12-31'))).toBe('Dec 31, 2024');
		}
	);

	test('an instant still renders its LOCAL calendar day, not the date-only shortcut', () => {
		expect(withTimeZone('America/Los_Angeles', () => formatDate('2024-03-15T01:30:00.000Z'))).toBe(
			'Mar 14, 2024'
		);
		expect(withTimeZone('Pacific/Kiritimati', () => formatDate('2024-03-15T23:30:00.000Z'))).toBe(
			'Mar 16, 2024'
		);
	});
});
