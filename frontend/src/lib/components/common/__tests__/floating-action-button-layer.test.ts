import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import FloatingActionButton from '../floating-action-button.svelte';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
const OVERLAYS = ['dialog/dialog-overlay.svelte', 'sheet/sheet-overlay.svelte'];

function zLayer(classes: string): number {
	const match = classes.match(/(?:^|[\s'"])z-(\d+)(?=[\s'"]|$)/);
	if (!match) throw new Error(`no z-index class in: ${classes.slice(0, 80)}`);
	return Number(match[1]);
}

describe('FloatingActionButton layer', () => {
	test.each(OVERLAYS)('sits below the %s backdrop', overlay => {
		render(FloatingActionButton, { label: 'Add Expense', href: '/expenses/new' });
		const fab = screen.getByRole('link', { name: 'Add Expense' });
		const overlayLayer = zLayer(readFileSync(join(UI, overlay), 'utf8'));

		expect(zLayer(fab.className)).toBeLessThan(overlayLayer);
	});
});
