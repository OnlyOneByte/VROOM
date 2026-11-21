import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROUTES = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGES_WITH_FAB = ['dashboard', 'expenses', 'reminders', 'trips'];

describe('pages with a floating action button leave room for it', () => {
	test.each(PAGES_WITH_FAB)(
		'/%s pads its content past the FAB (pb-24 >= h-16 + bottom-4)',
		page => {
			const src = readFileSync(join(ROUTES, page, '+page.svelte'), 'utf8');
			expect(src).toMatch(/<FloatingActionButton/);
			expect(src).toMatch(/<div class="[^"]*\bpb-24\b[^"]*">/);
		}
	);

	test('the FAB stays 64px tall, 16px off the bottom on mobile and 32px from sm: up', () => {
		const fab = readFileSync(
			join(ROUTES, '..', 'lib', 'components', 'common', 'floating-action-button.svelte'),
			'utf8'
		);
		expect(fab).toMatch(/\bbottom-4\b/);
		expect(fab).toMatch(/\bh-16\b/);
		expect(fab).toMatch(/\bsm:bottom-8\b/);
	});
});
