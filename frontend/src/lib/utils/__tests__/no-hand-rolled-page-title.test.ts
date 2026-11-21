import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HAND_ROLLED_H1 = /<h1[\s>]/;

const files = collectSvelteFiles(SRC_ROOT);
const rel = (file: string) => relative(SRC_ROOT, file).split('\\').join('/');

ratchet({
	name: 'page titles render through PageHeader',
	kind: 'exclusion',
	tolerated: [
		'lib/components/common/page-header.svelte',
		'routes/+page.svelte',
		'routes/auth/+page.svelte',
		'routes/privacypolicy/+page.svelte',
		'routes/termsofservice/+page.svelte'
	],
	guidance:
		'A hand-rolled <h1>. Render the page title with common/page-header.svelte ' +
		'(title, description, back and actions snippets) so every page shares one title style:',
	scan: () => files.filter(file => HAND_ROLLED_H1.test(readFileSync(file, 'utf8'))).map(rel),
	probe: () => {
		expect(HAND_ROLLED_H1.test('<h1 class="text-3xl">Title</h1>')).toBe(true);
		expect(HAND_ROLLED_H1.test('<h1>Title</h1>')).toBe(true);
		expect(HAND_ROLLED_H1.test('<PageHeader title="Title" />')).toBe(false);
		expect(HAND_ROLLED_H1.test('<h2 class="text-xl">Section</h2>')).toBe(false);
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});
