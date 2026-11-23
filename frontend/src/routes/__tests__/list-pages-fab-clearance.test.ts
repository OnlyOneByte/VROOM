import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROUTES = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGES_WITH_FAB = [
	'dashboard',
	'expenses',
	'reminders',
	'trips',
	'insurance',
	'vehicles/[id]'
];

function pageSource(page: string): string {
	return readFileSync(join(ROUTES, page, '+page.svelte'), 'utf8');
}

describe('pages with a floating action button leave room for it', () => {
	test.each(PAGES_WITH_FAB)(
		'/%s pads its content past the FAB (pb-24 >= h-14 + bottom-4)',
		page => {
			const src = pageSource(page);
			expect(src).toMatch(/<FloatingActionButton/);
			expect(src).toMatch(/<div class="[^"]*\bpb-24\b[^"]*">/);
		}
	);

	test('the FAB is 56px tall on the primary token, 16px off the bottom on mobile and 32px from sm: up', () => {
		const fab = readFileSync(
			join(ROUTES, '..', 'lib', 'components', 'common', 'floating-action-button.svelte'),
			'utf8'
		);
		expect(fab).toMatch(/\bbottom-4\b/);
		expect(fab).toMatch(/\bh-14\b/);
		expect(fab).toMatch(/\bsm:bottom-8\b/);
		expect(fab).not.toMatch(/\b(?:bg-foreground|text-background|transition-all|hover:scale-\d+)\b/);
	});
});

describe('the FAB is the mobile primary only', () => {
	test('it hides from lg: up', () => {
		const fab = readFileSync(
			join(ROUTES, '..', 'lib', 'components', 'common', 'floating-action-button.svelte'),
			'utf8'
		);
		expect(fab).toMatch(/\blg:hidden\b/);
	});

	test.each(PAGES_WITH_FAB)('/%s shows the same action as a header button from lg: up', page => {
		const src = pageSource(page);
		const labels = [...src.matchAll(/<FloatingActionButton[^>]*\blabel=\{?["']?([^"'}]+)/g)].map(
			match => match[1] ?? ''
		);
		expect(labels.length).toBeGreaterThan(0);
		expect(src).toMatch(/class="hidden lg:inline-flex"/);
		for (const label of labels) {
			const headerAction = new RegExp(
				`class="hidden lg:inline-flex"[^>]*>\\s*<Plus[^>]*/>\\s*\\{?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
			);
			expect(src, `${page}: no lg header button for "${label}"`).toMatch(headerAction);
		}
	});
});
