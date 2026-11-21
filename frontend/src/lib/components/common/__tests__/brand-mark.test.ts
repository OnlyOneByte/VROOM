import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from '#lib/utils/__tests__/_helpers/collect-svelte-files';
import BrandMark from '../BrandMark.svelte';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CAR_EMOJI = /\u{1F697}/u;

describe('BrandMark', () => {
	test('renders a decorative svg in the theme primary colour', () => {
		const { container } = render(BrandMark);
		const svg = container.querySelector('svg[data-brand-mark]');
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute('aria-hidden')).toBe('true');
		expect(svg?.getAttribute('class')).toContain('text-primary');
	});

	test('a caller class overrides the default colour and size', () => {
		const { container } = render(BrandMark, { class: 'h-4 w-4 text-muted-foreground' });
		const classes = container.querySelector('svg')?.getAttribute('class') ?? '';
		expect(classes).toContain('text-muted-foreground');
		expect(classes).not.toContain('text-primary');
		expect(classes).toContain('h-4');
		expect(classes).not.toContain('h-6');
	});
});

describe('the brand mark is never the car emoji', () => {
	const files = collectSvelteFiles(SRC_ROOT);

	test('no .svelte file renders the car emoji', () => {
		const offending = files
			.filter(file => CAR_EMOJI.test(readFileSync(file, 'utf-8')))
			.map(file => relative(SRC_ROOT, file).replace(/\\/g, '/'));
		expect(offending, 'use <BrandMark /> from lib/components/common').toEqual([]);
	});

	test('the scan is non-vacuous', () => {
		expect(files.length).toBeGreaterThan(50);
		expect(CAR_EMOJI.test('<span>\u{1F697}</span>')).toBe(true);
	});
});
