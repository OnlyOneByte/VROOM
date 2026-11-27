import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from '#lib/utils/__tests__/_helpers/collect-svelte-files';
import Wordmark from '../Wordmark.svelte';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const HAND_WRITTEN = /VR<span class="text-accent-ink">O<\/span>OM/;

describe('Wordmark', () => {
	test('with a link, it is a named link with the accent O', () => {
		render(Wordmark, { href: '/dashboard', class: 'justify-self-start' });
		const link = screen.getByRole('link', { name: 'VROOM home' });
		expect(link.getAttribute('href')).toBe('/dashboard');
		expect(link.textContent?.trim()).toBe('VROOM');
		expect(link.querySelector('span.text-accent-ink')?.textContent).toBe('O');
		expect(link.className).toContain('justify-self-start');
		expect(link.className).toContain('focus-visible:ring-2');
	});

	test('the link name can be changed', () => {
		render(Wordmark, { href: '/', label: 'VROOM, back to start' });
		expect(screen.getByRole('link', { name: 'VROOM, back to start' })).toBeTruthy();
	});

	test('without a link, it is plain text', () => {
		const { container } = render(Wordmark);
		expect(screen.queryByRole('link')).toBeNull();
		expect(container.textContent?.trim()).toBe('VROOM');
	});
});

describe('the wordmark is written once', () => {
	test('no other .svelte file hand-writes it', () => {
		const offending = collectSvelteFiles(SRC_ROOT)
			.filter(file => !file.endsWith('Wordmark.svelte'))
			.filter(file => HAND_WRITTEN.test(readFileSync(file, 'utf-8')))
			.map(file => relative(SRC_ROOT, file).replace(/\\/g, '/'));
		expect(offending, 'use <Wordmark /> from lib/components/common').toEqual([]);
	});

	test('the scan is non-vacuous', () => {
		const own = readFileSync(join(SRC_ROOT, 'lib/components/common/Wordmark.svelte'), 'utf-8');
		expect(HAND_WRITTEN.test(own)).toBe(true);
	});
});
