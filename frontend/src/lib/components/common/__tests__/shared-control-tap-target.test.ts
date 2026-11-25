import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { collectSvelteFiles } from '../../../utils/__tests__/_helpers/collect-svelte-files';
import PaginationControls from '../pagination-controls.svelte';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAROUSEL_ARROW_TAG = /<Carousel\.(?:Previous|Next)\b[^>]*>/g;
const BREAKPOINT_SHRINK = /\b(h|size)-1\d (?:sm|md):\1-[1-9]\b/;
const SMALL_SIZE =/(?:^|[\s"'])(?:size|h|w)-[1-9](?=[\s"'])|\bsize="(?:icon|icon-sm|sm|default)"/;

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
		['class="h-10 sm:w-auto"', false],
		['class="h-12 sm:h-10"', false]
	])('the breakpoint-shrink check flags %s: %s', (attrs, flagged) => {
		expect(BREAKPOINT_SHRINK.test(attrs)).toBe(flagged);
	});

	test('no control drops below 40px at a wider breakpoint', () => {
		const offenders = collectSvelteFiles(join(COMPONENTS, '..', '..')).filter(file =>
			BREAKPOINT_SHRINK.test(readFileSync(file, 'utf8'))
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
