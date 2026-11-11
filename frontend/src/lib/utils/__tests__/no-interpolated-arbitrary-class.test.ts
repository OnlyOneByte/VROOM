import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const INTERPOLATED_ARBITRARY = /[\w-]+-\[[^\]]*\{[^\]]*\]/;

const KNOWN_MASKED = new Set([
	'lib/components/charts/ExpenseTrendChart.svelte',
	'lib/components/charts/FuelEfficiencyTrendChart.svelte'
]);

function stripComments(source: string): string {
	const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
	return withoutBlocks
		.split('\n')
		.map(line => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('*') || trimmed.startsWith('<!--') || trimmed.startsWith('-->'))
				return '';
			const idx = line.indexOf('//');
			if (idx === -1) return line;
			if (idx > 0 && line[idx - 1] === ':') return line;
			return line.slice(0, idx);
		})
		.join('\n');
}

describe('no interpolated arbitrary Tailwind classes (dead-class guard)', () => {
	const files = collectSvelteFiles(SRC_ROOT);

	test('the scan actually found .svelte sources (guard is live, not a no-op)', () => {
		expect(files.length).toBeGreaterThan(30);
	});

	test('no .svelte uses an interpolated arbitrary value class (use an inline style instead)', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			if (KNOWN_MASKED.has(rel)) continue;

			const rawLines = readFileSync(file, 'utf8').split('\n');
			const cleanLines = stripComments(rawLines.join('\n')).split('\n');
			cleanLines.forEach((line, idx) => {
				if (INTERPOLATED_ARBITRARY.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${(rawLines[idx] ?? line).trim()}`);
				}
			});
		}

		expect(
			offenders,
			`Interpolated arbitrary Tailwind class(es) found — Tailwind can't generate a rule for a runtime-interpolated arbitrary value, so the utility is silently dead. Use an inline style="..." for dynamic sizing instead:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});
