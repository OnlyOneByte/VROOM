/**
 * Regression GUARD (committed, travels with the merge) for the #87 bug class (C267 extract / C268 fix /
 * C271 residual): converting a Date to the `YYYY-MM-DD` string an `<input type="date">` binds to via
 * the UTC calendar date — `new Date(x).toISOString().split('T')[0]` or `.toISOString().slice(0, 10)`.
 *
 * That reads the UTC date, which (a) shows TOMORROW for a negative-offset (Americas) user editing late
 * in the day, and (b) BREAKS the stored-date round-trip — dateOnlyToISO persists date-only values at
 * NOON LOCAL, and noon-local in a positive offset is the PREVIOUS day in UTC, so a saved date reloads
 * one day earlier in the edit form (#87). The fix routes every such conversion through
 * `toDateInputValue` (formatters.ts), which reads LOCAL components (getFullYear/getMonth+1/getDate).
 * C267 collapsed 9 sites; C268 made the helper local; C271 caught a residual on the odometer-edit page.
 * This pins that no source REINTRODUCES the raw `.toISOString()`-to-date-string antipattern.
 *
 * Scans every .svelte/.ts source (comments stripped) for `.toISOString().split('T')[0]` /
 * `.toISOString().slice(0, 10)`. The fix (toDateInputValue) never matches. Runs in the fast unit suite.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The UTC date-input antipattern: an ISO string sliced to its date part to feed a date input.
//   new Date(x).toISOString().split('T')[0]
//   new Date(x).toISOString().slice(0, 10)   (whitespace-tolerant on the slice args)
// toDateInputValue (the fix) builds the string from local getFullYear/getMonth/getDate — no
// .toISOString() in the chain — so it never matches.
const UTC_DATE_INPUT = /\.toISOString\(\)\s*\.\s*(?:split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\]|slice\(\s*0\s*,\s*10\s*\))/;

// The SECOND form of the same bug (#131, C437; #138, C449): a stored ISO date STRING field read straight
// to its date part to feed a date input — `r.startDate.slice(0, 10)` (#131) OR `t.startDate.split('T')[0]`
// (#138, InsuranceTermForm/ClaimsSection). There is no `.toISOString()` in the chain (the value is ALREADY
// a string), so UTC_DATE_INPUT misses it — exactly how ReminderForm.svelte:116 (the `.slice` form) and the
// two insurance forms (the `.split('T')[0]` form) each slipped past for hundreds of cycles. Either way the
// first-10-chars / pre-`T` segment is the UTC calendar date, which for a UTC+13/+14 user is the PREVIOUS
// day vs the noon-local ISO the save persists → the date shifts back every edit-open. Fix is the same:
// toDateInputValue(field). This matches a date-typed PROPERTY access taken to its date part by EITHER
// `.slice(0,10)` OR `.split('T')[0]` — narrow enough to SKIP the safe sites (expense-filters'
// `dateStr.slice(0,10).split('-')` local-parse on a generic param, and a tags-array `.slice(0, 10)` cap —
// neither is a date-field property access).
const ISO_STRING_DATE_SLICE =
	/\.(?:startDate|endDate|dueDate|nextDueDate|purchaseDate|serviceDate|paymentDate|claimDate)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\])/;

function stripComments(source: string): string {
	// Replace block comments with newline-preserving blanks so line numbers stay aligned with the raw source.
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
	return withoutBlocks
		.split('\n')
		.map((line) => {
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
			// Skip test dirs: a test file may legitimately assert against the idiom (e.g. an expected
			// default value). This guard protects PRODUCT code from reintroducing it.
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit' || entry.name === '__tests__')
				continue;
			collectSourceFiles(full, acc);
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('no UTC date-input formatting (use toDateInputValue — #87 class guard)', () => {
	const files = collectSourceFiles(SRC_ROOT);

	test('the scan actually found sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test('no source builds a date-input value via new Date(x).toISOString().split/slice', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			// The guard test itself names the pattern in strings/comments — skip it.
			if (rel.endsWith('__tests__/no-utc-date-input.test.ts')) continue;

			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (UTC_DATE_INPUT.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
				}
			});
		}

		expect(
			offenders,
			`Date-input value built from the UTC calendar date — use toDateInputValue() from ` +
				`formatters.ts (local getFullYear/getMonth/getDate) so the date is correct in every ` +
				`timezone and round-trips with dateOnlyToISO (#87):\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('no source slices a stored ISO date-field STRING to its first 10 chars for a date input (#131)', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			if (rel.endsWith('__tests__/no-utc-date-input.test.ts')) continue;

			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (ISO_STRING_DATE_SLICE.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
				}
			});
		}

		expect(
			offenders,
			`A stored ISO date-field string sliced to [0,10) feeds the UTC calendar date to a date input ` +
				`(#131, the #87 family on the second form) — use toDateInputValue(new Date(field)) so the ` +
				`local date round-trips with dateOnlyToISO in every timezone:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
