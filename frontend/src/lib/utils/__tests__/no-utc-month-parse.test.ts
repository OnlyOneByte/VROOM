/**
 * Regression GUARD (committed, travels with the merge) for the cycle-211 bug class:
 * parsing a "YYYY-MM" month bucket into a Date by string-concatenating "-01".
 *
 * `new Date('2024-03-01')` parses as midnight UTC, so a negative-offset user (e.g. UTC-8)
 * gets a Date that is 2024-02-29 *local* — and a chart x-axis tick renders "Feb" for a
 * March bucket. The vehicle-detail trend chart did exactly this; the fix routes every
 * month-bucket parse through `parseMonthToDate` (chart-formatters.ts), which builds the
 * date in LOCAL time via `new Date(year, monthIndex, 1)`. The other analytics tabs already
 * used the helper; this pins that no source REINTRODUCES the raw-string antipattern.
 *
 * Scans every .svelte/.ts source (comments stripped) for `new Date(<…> + '-01')` /
 * `"-01")` / a `…-01` template literal handed to the Date string constructor. The fix
 * (parseMonthToDate / new Date(y, m, 1)) never matches. Runs in the fast unit suite.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The midnight-UTC month-bucket antipattern: a "-01" day suffix CONCATENATED onto a
// month variable and handed to the Date string constructor — either
//   new Date(expr + '-01')   (string concat, day char before -01 is a quote)
//   new Date(`${expr}-01`)   (template literal, day char before -01 is a `}`)
// The char immediately before "-01" must be a quote/backtick (concat) or `}` (interp) —
// NOT a digit, so a full literal date like new Date('2024-01-01') does NOT match, and the
// fix new Date(year, monthIndex, 1) (no quoted "-01") never matches.
const UTC_MONTH_PARSE = /new\s+Date\s*\([^)]*['"`}]-01\s*['"`]\s*\)/;

function stripComments(source: string): string {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
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
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			collectSourceFiles(full, acc);
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('no UTC midnight month-bucket parsing (use parseMonthToDate — cycle 211 class guard)', () => {
	const files = collectSourceFiles(SRC_ROOT);

	test('the scan actually found sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test('no source parses a "YYYY-MM" bucket via new Date(… + "-01")', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			// The guard test itself names the pattern in strings/comments — skip it.
			if (rel.endsWith('__tests__/no-utc-month-parse.test.ts')) continue;

			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (UTC_MONTH_PARSE.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
				}
			});
		}

		expect(
			offenders,
			`Month-bucket parsed as midnight UTC — use parseMonthToDate() from chart-formatters.ts ` +
				`(local time, new Date(y, m, 1)) so the month label is correct west of UTC (cycle 211):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
