import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from '../../../../utils/__tests__/_helpers/collect-svelte-files';
import Checkbox from '../checkbox.svelte';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const LIST_ROW_WRAPPING_CHECKBOX = /\{#each[^}]*\}\s*<label\b([^>]*)>\s*<Checkbox\b/g;

describe('Checkbox', () => {
	test('keeps its 16px box but has a 40x40 hit area centred on it', () => {
		render(Checkbox, { props: { 'aria-label': 'Missed previous fill-up' } });
		const box = screen.getByRole('checkbox', { name: 'Missed previous fill-up' });

		expect(box.className).toContain('size-4');
		expect(box.className).toContain('relative');
		for (const cls of ['before:absolute', 'before:size-10', 'before:left-1/2', 'before:top-1/2']) {
			expect(box.className).toContain(cls);
		}
	});

	test('still toggles when clicked', async () => {
		render(Checkbox, { props: { 'aria-label': 'Missed previous fill-up' } });
		const box = screen.getByRole('checkbox', { name: 'Missed previous fill-up' });

		await fireEvent.click(box);
		expect(box).toHaveAttribute('aria-checked', 'true');
	});

	test('every list row that wraps a Checkbox is 40px tall, so stacked hit areas never overlap', () => {
		const rows: string[] = [];
		const offenders: string[] = [];
		for (const file of collectSvelteFiles(SRC_ROOT)) {
			for (const [, attrs = ''] of readFileSync(file, 'utf8').matchAll(
				LIST_ROW_WRAPPING_CHECKBOX
			)) {
				const where = relative(SRC_ROOT, file);
				rows.push(where);
				if (!/(?:^|[\s"'])min-h-10(?=[\s"'])/.test(attrs)) offenders.push(where);
			}
		}

		expect(rows.length, 'the scan found no label-wrapped checkboxes').toBeGreaterThanOrEqual(4);
		expect(offenders).toEqual([]);
	});
});
