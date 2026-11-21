import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HARDCODED_DOLLAR = />\s*\$\s*</;
const PENDING = new Set(['lib/components/financing/PaymentPlannerDialog.svelte']);

describe('no hardcoded "$" in markup (use getCurrencySymbol)', () => {
	const files = collectSvelteFiles(SRC_ROOT);

	test('the scan found sources', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test('no component renders a literal "$" text node', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			if (PENDING.has(rel)) continue;
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, idx) => {
					if (HARDCODED_DOLLAR.test(line)) offenders.push(`${rel}:${idx + 1}  ${line.trim()}`);
				});
		}
		expect(offenders, `Use getCurrencySymbol() instead:\n${offenders.join('\n')}`).toEqual([]);
	});

	test('pending files still exist and still need the fix', () => {
		for (const rel of PENDING) {
			expect(HARDCODED_DOLLAR.test(readFileSync(join(SRC_ROOT, rel), 'utf8'))).toBe(true);
		}
	});
});
