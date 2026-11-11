import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const UTC_MONTH_PARSE = /new\s+Date\s*\([^)]*['"`}]-01\s*['"`]\s*\)/;

function stripComments(source: string): string {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
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
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			collectSourceFiles(full, acc);
		} else if (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('no UTC midnight month-bucket parsing (use parseMonthToDate — class guard)', () => {
	const files = collectSourceFiles(SRC_ROOT);

	test('the scan actually found sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test('no source parses a "YYYY-MM" bucket via new Date(… + "-01")', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
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
				`(local time, new Date(y, m, 1)) so the month label is correct west of UTC:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
