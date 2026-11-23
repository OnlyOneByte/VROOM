import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const CATEGORICAL_USES = [
	'lib/components/settings/storage-provider/DefaultPhotoSources.svelte',
	'routes/+page.svelte'
];

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === '__tests__' ? [] : svelteFiles(full);
		return entry.name.endsWith('.svelte') ? [full] : [];
	});
}

describe('status colours use the warning token, not chart-5', () => {
	test('no screen styles text, a tint, a border or a fill with chart-5 outside the allow list', () => {
		const offenders = svelteFiles(SRC)
			.map(file => relative(SRC, file).replace(/\\/g, '/'))
			.filter(file => !file.startsWith('lib/components/charts/'))
			.filter(file => !CATEGORICAL_USES.includes(file))
			.filter(file => /\b(?:text|bg|border)-chart-5\b/.test(readFileSync(join(SRC, file), 'utf8')));
		expect(offenders).toEqual([]);
	});

	test('the allow list still matches real uses (non-vacuous)', () => {
		for (const file of CATEGORICAL_USES) {
			expect(readFileSync(join(SRC, file), 'utf8'), file).toMatch(/\b(?:text|bg)-chart-5\b/);
		}
	});
});
