import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const NOT_YET_MOVED = [
	'lib/components/expenses/ImportFromPhotosDialog.svelte',
	'lib/components/insurance/form/InsurancePolicyForm.svelte',
	'lib/components/settings/cards/StorageProvidersCard.svelte',
	'lib/components/vehicles/form/VehicleForm.svelte',
	'routes/assistant/+page.svelte',
	'routes/settings/+page.svelte',
	'routes/settings/providers/[id]/edit/+page.svelte',
	'routes/vehicles/[id]/+page.svelte'
];

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === '__tests__' ? [] : svelteFiles(path);
		return path.endsWith('.svelte') ? [path] : [];
	});
}

function handWritesLoadErrorCard(source: string): boolean {
	return (
		/<p class="font-medium">\s*(?:\{[^}]*)?"?Couldn't load/.test(source) &&
		source.includes('CircleAlert')
	);
}

describe('load failures use LoadErrorCard', () => {
	test('no new file hand-writes a CircleAlert "Couldn\'t load" card', () => {
		const handWritten = svelteFiles(SRC)
			.filter(path => handWritesLoadErrorCard(readFileSync(path, 'utf8')))
			.map(path => relative(SRC, path))
			.sort();

		expect(handWritten).toEqual(NOT_YET_MOVED);
	});
});
