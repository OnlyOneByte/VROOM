/**
 * Guards for ONE bug class with four shapes: a DATE-ONLY value — the `YYYY-MM-DD` string an
 * `<input type="date">` binds to — crossing between a string and an instant on the UTC calendar
 * instead of the local one.
 *
 * `new Date('2024-03-15')` is MIDNIGHT UTC and `toISOString()` reports the UTC day, so every such
 * crossing shifts the user's calendar day by one:
 *  - reading the UTC day out of an instant (`.toISOString().slice(0, 10)`, or slicing a stored ISO
 *    string) shows TOMORROW for a negative-offset (Americas) user editing late in the day, and
 *    breaks the round-trip of a stored date, which is persisted at NOON LOCAL;
 *  - reading a date-only value on the LOCAL calendar after `new Date()` parsed it as midnight UTC
 *    shows YESTERDAY for that same user;
 *  - persisting a date-only value raw hands that midnight-UTC parse to the backend, so the date
 *    comes back a day early for everyone west of UTC.
 *
 * formatters.ts owns the only sanctioned crossings: `toDateInputValue` (instant → date-only, via
 * the local getFullYear/getMonth/getDate) and `dateOnlyToISO` (date-only → instant at noon local,
 * which no real offset of ±14h can push across local midnight). `formatDate` also parses a
 * date-only string on the local calendar, so a rendered day is right even when a caller hands it
 * one directly; the scans below keep the source EXPLICIT about which parse it means and cover the
 * reads and writes formatDate cannot — a local `getDate()`, a `toLocaleDateString()`, a persist.
 *
 * Every scan is paired with positive and negative control samples, so the pattern is itself proven
 * able to fail rather than merely passing over a clean tree.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { formatDate } from '$lib/utils/formatters';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The UTC date-input antipattern: an ISO string sliced to its date part to feed a date input.
//  new Date(x).toISOString().split('T')[0]
//  new Date(x).toISOString().slice(0, 10) (whitespace-tolerant on the slice args)
// toDateInputValue builds the string from local getFullYear/getMonth/getDate — no
// .toISOString() in the chain — so it never matches.
const UTC_DATE_INPUT =
	/\.toISOString\(\)\s*\.\s*(?:split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\]|slice\(\s*0\s*,\s*10\s*\))/g;

// The SECOND shape: a stored ISO date STRING field read straight to its date part to feed a date
// input — `term.startDate.slice(0, 10)` or `term.startDate.split('T')[0]`. There is no
// `.toISOString()` in the chain (the value is ALREADY a string), so UTC_DATE_INPUT misses it, which
// is how both forms slipped past. Either way the first-10-chars / pre-`T` segment is the UTC
// calendar date, which for a UTC+13/+14 user is the PREVIOUS day vs the noon-local ISO the save
// persists → the date shifts back on every edit-open. Fix is the same: toDateInputValue(field).
// Matching a date-typed PROPERTY access is narrow enough to SKIP the safe sites (expense-filters'
// `dateStr.slice(0, 10).split('-')` local parse of a generic param, and a tags-array `.slice(0, 10)`
// cap — neither is a date-field property access).
const ISO_STRING_DATE_SLICE =
	/\.(?:startDate|endDate|dueDate|nextDueDate|purchaseDate|serviceDate|paymentDate|claimDate)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\])/g;

/**
 * A recognizably DATE-ONLY value, which is what makes the UTC parse wrong: a property of a
 * form-state object (`formData.date`, `financingForm.startDate`) or one of the bare `$state`
 * identifiers the date pickers bind (`startDate` / `endDate` / `claimDate` / …). A loaded entity's
 * full ISO timestamp (`originalExpense.date`, `vehicle.purchaseDate`, `backup.createdTime`) is NOT
 * date-only and is correctly excluded — reading its LOCAL calendar day is the intent there.
 */
const DATE_ONLY_FORM_VALUE = String.raw`(?:\w*[Ff]orm\w*\s*(?:\.\s*\w+|\[\s*['"\`]\w+['"\`]\s*\])|(?:start|end|due|trip|service|claim|purchase)Date\b)`;

/** Reading a Date on the host's LOCAL calendar — the read that exposes the midnight-UTC shift. */
const LOCAL_CALENDAR_READ = String.raw`(?:toLocale(?:Date|Time)?String|getDate|getMonth|getFullYear|getDay)`;

/** The formatters that render a date, each of which reads its argument on the local calendar. */
const DATE_FORMATTER = String.raw`(?:formatDate|formatDateTick|formatRelativeTime)`;

// The THIRD shape, on the READ direction: a date-only form value parsed by `new Date()` (midnight
// UTC) and then read locally, which renders the PREVIOUS day for a negative-offset user. Covers the
// whole class, not one byte-shape: the local read may be a method on the Date
// (`new Date(formData.date).toLocaleDateString()`) or a date formatter the value is handed to
// directly or pre-wrapped (`formatDate(formData.date)`, `formatDate(new Date(formData.date))`) —
// the last of which is the obvious "simplification" of the fix and reproduces the identical bug.
// The sanctioned `formatDate(dateOnlyToISO(value))` never matches: the parse is named in between.
// Date-only COMPARISONS (`new Date(endDate) <= new Date(startDate)`) are excluded deliberately —
// both sides shift by the same offset, so only a local-calendar READ is wrong.
const UTC_PARSE_OF_DATE_ONLY = new RegExp(
	// `new Date(<date-only value>…).<local read>` — `[^)]*` cannot cross a `)`, so the match stays
	// inside the one call; `\s*` spans newlines so a prettier-wrapped call can't evade the scan.
	String.raw`new Date\(\s*${DATE_ONLY_FORM_VALUE}[^)]*\)\s*\.\s*${LOCAL_CALENDAR_READ}` +
		String.raw`|${DATE_FORMATTER}\(\s*(?:new Date\(\s*)?${DATE_ONLY_FORM_VALUE}`,
	'g'
);

/** The date-ish keys of a persisted payload: what the backend will store as an instant. */
const PERSISTED_DATE_KEY = String.raw`(?:date|startDate|endDate|dueDate|nextDueDate|tripDate|claimDate|purchaseDate|paymentDate|serviceDate|recordedAt)`;

// The FOURTH shape, on the WRITE direction: a date-only form value persisted RAW, leaving the
// midnight-UTC parse to the backend (`z.coerce.date()`), so the stored instant is a day early for
// every negative-offset user and reads back as the previous day. Every form crosses this boundary
// with dateOnlyToISO (noon local) — this pins that none of them stops doing so. The value must be
// the WHOLE expression (next char is `,`, `}` or a newline), which skips a ternary that guards the
// parse (`endDate: endDate ? dateOnlyToISO(endDate) : null`) and the form-state literal itself
// (`date: toDateInputValue(new Date())`), where a date-only value is exactly what belongs.
const RAW_DATE_ONLY_PERSISTED = new RegExp(
	String.raw`\b${PERSISTED_DATE_KEY}\s*:\s*${DATE_ONLY_FORM_VALUE}\s*(?=[,}\n])`,
	'g'
);

function stripComments(source: string): string {
	// Replace block comments with newline-preserving blanks so line numbers stay aligned with the raw source.
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
	return withoutBlocks
		.split('\n')
		.map(line => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('*')) return '';
			const idx = line.indexOf('//');
			if (idx === -1) return line;
			if (idx > 0 && line[idx - 1] === ':') return line; // keep URLs
			return line.slice(0, idx);
		})
		.join('\n');
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			// Skip test dirs: a test file may legitimately assert against the idiom (e.g. the control
			// samples below). These guards protect PRODUCT code from reintroducing it.
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

/** Every `file:line  match` a pattern finds across the product sources. */
function scanSources(pattern: RegExp): string[] {
	const offenders: string[] = [];
	for (const file of files) {
		const rel = relative(SRC_ROOT, file).split('\\').join('/');
		// Scan the WHOLE file (not line by line): an offending call may be wrapped across lines.
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

/** True when `pattern` matches `sample` — `lastIndex` reset, since every pattern is global. */
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

	// The guards above pass over a clean tree; these pin that they can still FAIL. Each positive
	// control is a shape that shipped the user-visible day-shift at least once; each negative control
	// is a sanctioned shape that must stay quiet, so the patterns can't be widened into noise.
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

/**
 * The structural half of the fix: formatDate reads a date-only string as a LOCAL calendar day, so
 * even a caller that hands it a raw picker value renders the day the user picked. Node re-reads
 * process.env.TZ for each Date/Intl operation, so pinning the zone per case is what makes this
 * assertion able to fail — in a UTC or positive-offset host zone the old midnight-UTC parse also
 * returned "Mar 15, 2024", and the test would have been blind.
 */
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

	// America/Los_Angeles (-7/-8) is where midnight UTC lands on the previous day; Kiritimati (+14)
	// is the opposite extreme; UTC is the boundary itself.
	test.each(['America/Los_Angeles', 'America/New_York', 'UTC', 'Pacific/Kiritimati'])(
		'%s',
		zone => {
			expect(withTimeZone(zone, () => formatDate('2024-03-15'))).toBe('Mar 15, 2024');
			expect(withTimeZone(zone, () => formatDate('2024-01-01'))).toBe('Jan 1, 2024');
			expect(withTimeZone(zone, () => formatDate('2024-12-31'))).toBe('Dec 31, 2024');
		}
	);

	test('an instant still renders its LOCAL calendar day, not the date-only shortcut', () => {
		// A full timestamp is a real instant: Mar 15 01:30 UTC is still Mar 14 in Los Angeles.
		expect(withTimeZone('America/Los_Angeles', () => formatDate('2024-03-15T01:30:00.000Z'))).toBe(
			'Mar 14, 2024'
		);
		expect(withTimeZone('Pacific/Kiritimati', () => formatDate('2024-03-15T23:30:00.000Z'))).toBe(
			'Mar 16, 2024'
		);
	});
});
