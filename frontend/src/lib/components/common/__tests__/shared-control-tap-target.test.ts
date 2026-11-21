import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { collectSvelteFiles } from '../../../utils/__tests__/_helpers/collect-svelte-files';
import PaginationControls from '../pagination-controls.svelte';

const COMPONENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CAROUSEL_ARROW_TAG = /<Carousel\.(?:Previous|Next)\b[\s\S]*?\/>/g;
const SMALL_SIZE = /\b(?:size|h|w)-[1-9]\b/;

describe('shared controls meet the 40px tap target', () => {
	test('pagination Previous and Next are 40px tall', () => {
		render(PaginationControls, {
			currentOffset: 20,
			pageSize: 20,
			totalCount: 60,
			onPageChange: () => {}
		});

		for (const name of ['Previous', 'Next']) {
			expect(screen.getByRole('button', { name })).toHaveClass('h-10');
		}
	});

	test.each(['previous', 'next'])('carousel %s arrow is 40px', arrow => {
		const source = readFileSync(join(COMPONENTS, `ui/carousel/carousel-${arrow}.svelte`), 'utf8');
		expect(source).toContain("size = 'icon-lg'");
		expect(source).toContain("'absolute size-10 rounded-full'");
	});

	test('no page shrinks a carousel arrow below 40px', () => {
		const offenders = collectSvelteFiles(join(COMPONENTS, '..', '..')).filter(file =>
			(readFileSync(file, 'utf8').match(CAROUSEL_ARROW_TAG) ?? []).some(tag => SMALL_SIZE.test(tag))
		);
		expect(offenders).toEqual([]);
	});
});
