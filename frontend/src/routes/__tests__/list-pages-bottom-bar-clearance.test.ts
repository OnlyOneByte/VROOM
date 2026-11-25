import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { isFormRoute } from '#lib/routes.ts';

const ROUTES = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROUTES, '..');
const LAYOUT = readFileSync(join(ROUTES, '+layout.svelte'), 'utf8');
const NAVIGATION = readFileSync(
	join(SRC, 'lib', 'components', 'layout', 'Navigation.svelte'),
	'utf8'
);
const APP_CSS = readFileSync(join(SRC, 'app.css'), 'utf8');

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === '__tests__' ? [] : svelteFiles(path);
		return name.endsWith('.svelte') ? [path] : [];
	});
}

describe('the phone bottom bar never covers a page', () => {
	test('the layout pads main past the bar and the raised +, below lg and off short screens', () => {
		expect(LAYOUT).toMatch(
			/!isFormRoute\(currentPath\) &&\s*'pb-\[calc\(6rem\+env\(safe-area-inset-bottom\)\)\] lg:pb-0 short:pb-0'/
		);
	});

	test('the bar is 4.25rem plus the safe area and the + rises 26px above it, inside the 6rem clearance', () => {
		expect(NAVIGATION).toMatch(/pt-2 pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
		expect(NAVIGATION).toMatch(/min-h-12/);
		expect(NAVIGATION).toMatch(/-mt-\[26px\] grid size-\[58px\]/);
	});

	test('focus scrolls clear of both bars, and the bars stop being fixed on short screens', () => {
		expect(APP_CSS).toMatch(
			/@variant max-lg \{\s*scroll-padding-top: calc\(4rem \+ env\(safe-area-inset-top\)\);\s*scroll-padding-bottom: calc\(6rem \+ env\(safe-area-inset-bottom\)\);\s*\}\s*@variant short \{\s*scroll-padding-top: 0;\s*scroll-padding-bottom: 0;/
		);
		expect(NAVIGATION).toMatch(/class="fixed short:static bottom-0/);
		expect(NAVIGATION).toMatch(/class="fixed short:static top-0/);
	});

	test('forms hide the bar and keep their own Save, so they get no clearance', () => {
		expect(NAVIGATION).toMatch(/let showBottomBar = \$derived\(!isFormRoute\(currentPath\)\)/);
		for (const path of [
			'/expenses/new',
			'/vehicles/v1/edit',
			'/settings/providers/new',
			'/insurance/p1/terms/new'
		]) {
			expect(isFormRoute(path), path).toBe(true);
		}
		for (const path of ['/dashboard', '/expenses', '/vehicles/v1', '/newsletter', '/settings']) {
			expect(isFormRoute(path), path).toBe(false);
		}
	});
});

describe('the floating action button is retired', () => {
	test('no route renders it and no page pads for it', () => {
		const offenders = svelteFiles(ROUTES)
			.filter(file =>
				/FloatingActionButton|floating-action-button|pb-24 short:pb-0/.test(
					readFileSync(file, 'utf8')
				)
			)
			.map(file => relative(SRC, file));
		expect(offenders).toEqual([]);
	});

	test.each(['dashboard', 'expenses', 'insurance', 'reminders', 'trips', 'vehicles/[id]'])(
		'/%s shows its primary action in the page header at every width',
		page => {
			const src = readFileSync(join(ROUTES, page, '+page.svelte'), 'utf8');
			expect(src).not.toMatch(/hidden lg:inline-flex short:inline-flex/);
		}
	);
});
