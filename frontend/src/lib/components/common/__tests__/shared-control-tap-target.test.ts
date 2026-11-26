import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { collectSvelteFiles } from '../../../utils/__tests__/_helpers/collect-svelte-files';
import PaginationControls from '../pagination-controls.svelte';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAROUSEL_ARROW_TAG = /<Carousel\.(?:Previous|Next)\b[^>]*>/g;
const BREAKPOINT_SHRINK = /\b(?:h|size)-1\d\b[^"'`{}\n]*?\b(?:sm|md):(?:h|w|size)-[1-9]\b/g;
const SIZED_BUTTON_SHRINK =
	/size="(?:icon-lg|lg|icon|default)"[^<]*?class="[^"]*\b(?:sm|md):(?:h|size)-[1-9]\b|class="[^"]*\b(?:sm|md):(?:h|size)-[1-9]\b[^"]*"[^<]*?size="(?:icon-lg|lg|icon|default)"/;
const SHRINK_EXCEPTIONS: Record<string, number> = {
	'expenses/expenses-table/ExpensesCompactList.svelte': 2,
	'expenses/form/CategorySelector.svelte': 1,
	'expenses/form/FuelFieldsSection.svelte': 2,
	'expenses/form/ExpenseForm.svelte': 1,
	'routes/vehicles/[id]/+page.svelte': 1
};

function shrinkCounts(): Record<string, number> {
	const counts: Record<string, number> = {};
	const src = join(COMPONENTS, '..', '..');
	for (const file of collectSvelteFiles(src)) {
		const hits = readFileSync(file, 'utf8').match(BREAKPOINT_SHRINK)?.length ?? 0;
		if (!hits) continue;
		const rel = file.slice(src.length + 1).replace(/^lib\/components\//, '');
		counts[rel] = hits;
	}
	return counts;
}
const SMALL_SIZE = /(?:^|[\s"'])(?:size|h|w)-[1-9](?=[\s"'])|\bsize="(?:icon|icon-sm|sm|default)"/;

describe('shared controls meet the 40px tap target', () => {
	test('pagination Previous and Next are 40px tall', () => {
		render(PaginationControls, {
			currentOffset: 20,
			pageSize: 20,
			totalCount: 60,
			onPageChange: () => {}
		});

		for (const name of ['Previous', 'Next']) {
			expect(screen.getByRole('button', { name })).toHaveClass('h-10', 'w-10', 'sm:w-auto');
		}
	});

	test.each([
		['size="icon"', true],
		['class="h-8 w-8 rounded-full"', true],
		['class="left-2 md:left-4 shadow-md"', false]
	])('the arrow-size check flags %s: %s', (attrs, flagged) => {
		const tag = `<Carousel.Next variant="ghost" ${attrs} />`.match(CAROUSEL_ARROW_TAG)?.[0] ?? '';
		expect(SMALL_SIZE.test(tag)).toBe(flagged);
	});

	test.each(['previous', 'next'])('carousel %s arrow is 40px', arrow => {
		const source = readFileSync(join(COMPONENTS, `ui/carousel/carousel-${arrow}.svelte`), 'utf8');
		expect(source).toMatch(/\bsize\s*=\s*'icon-lg'/);
		expect(source).toMatch(/'absolute\b[^']*\bsize-10\b/);
	});

	test.each([
		['class="h-10 sm:h-8"', true],
		['class="size-10 sm:size-9"', true],
		['class="h-10 md:h-9"', true],
		['class="h-10 text-destructive sm:h-9"', true],
		['class="h-10 text-xs sm:h-7"', true],
		['class="size-10 text-xs sm:h-7 sm:w-auto"', true],
		['class="size-10 sm:w-9"', true],
		['class="h-10 w-10 sm:w-auto"', false],
		['class="h-10 sm:w-auto"', false],
		['class="h-12 sm:h-10"', false],
		['class="h-10" /> <Button class="sm:h-8"', false]
	])('the breakpoint-shrink check flags %s: %s', (attrs, flagged) => {
		expect((attrs.match(BREAKPOINT_SHRINK)?.length ?? 0) > 0).toBe(flagged);
	});

	test('no 40px control shrinks at a wider breakpoint, outside the listed exceptions', () => {
		expect(shrinkCounts()).toEqual(SHRINK_EXCEPTIONS);
	});

	test.each([
		['<Button size="icon-lg"\n\tclass="sm:h-8 sm:w-9"', true],
		['<Button class="shrink-0 sm:size-9" size="icon-lg"', true],
		['<Button size="icon-lg" class="shrink-0"', false],
		['<Button size="sm" class="sm:h-8"', false]
	])('the sized-button check flags %s: %s', (tag, flagged) => {
		expect(SIZED_BUTTON_SHRINK.test(tag)).toBe(flagged);
	});

	test('no 40px button size is shrunk by an sm: or md: class', () => {
		const offenders = collectSvelteFiles(join(COMPONENTS, '..', '..')).filter(file =>
			SIZED_BUTTON_SHRINK.test(readFileSync(file, 'utf8'))
		);
		expect(offenders).toEqual([]);
	});

	test('no page shrinks a carousel arrow below 40px', () => {
		const offenders = collectSvelteFiles(join(COMPONENTS, '..', '..')).filter(file =>
			(readFileSync(file, 'utf8').match(CAROUSEL_ARROW_TAG) ?? []).some(tag => SMALL_SIZE.test(tag))
		);
		expect(offenders).toEqual([]);
	});
});
