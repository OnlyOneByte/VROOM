/**
 * An icon-only control needs an `aria-label`. A `title` is not a substitute: it is a mouse-only
 * tooltip, it never appears on a touch device, and the kit sets `pointer-events: none` on a
 * disabled control so the browser does not even hover-test it. `UIQuality.md` says so outright —
 * "Icon-only buttons MUST have aria-label" — but axe accepts `title` as an accessible name, so
 * the sweep that found the unnamed controls could not find the badly-named ones.
 *
 * These two files were the surviving instances. The offline cards are asserted by rendering them
 * and reading the names off the DOM; the odometer tab pulls in a chart and an API client, so it is
 * asserted against its source with a rule that generalises past today's two controls: a literal
 * `title` in that file must be matched by an `aria-label` carrying the same words.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import OfflineExpenseCards from '../expenses/OfflineExpenseCards.svelte';
import type { OfflineExpense } from '$lib/utils/offline-storage';

vi.mock('svelte', () => import('../../../../node_modules/svelte/src/index-client.js' as string));

const HERE = dirname(fileURLToPath(import.meta.url));
const ODOMETER_TAB = join(HERE, '..', 'vehicles', 'OdometerTab.svelte');

function offlineExpense(id: string): OfflineExpense {
	return {
		id,
		vehicleId: 'v1',
		category: 'fuel',
		amount: 45.5,
		date: '2024-03-15T12:00:00.000Z',
		description: 'Costco fill-up',
		tags: [],
		createdAt: '2024-03-15T12:00:00.000Z',
		synced: false
	} as unknown as OfflineExpense;
}

describe('the offline expense cards', () => {
	test('name every icon-only control with an aria-label', () => {
		const { container } = render(OfflineExpenseCards, {
			pendingExpenses: [offlineExpense('pending-1')],
			needsAttentionExpenses: [offlineExpense('parked-1')],
			syncedExpenses: [offlineExpense('synced-1')],
			onRemovePending: () => {}
		});

		const buttons = [...container.querySelectorAll('button')];
		expect(buttons.length).toBeGreaterThan(0);

		for (const button of buttons) {
			// Icon-only: the control renders an svg and no text of its own.
			if (button.textContent?.trim()) continue;
			expect(
				button.getAttribute('aria-label'),
				`icon-only control named only by title="${button.getAttribute('title')}"`
			).toBeTruthy();
		}

		// The two names, so a rename has to be deliberate rather than a silent drop to `title`.
		expect(container.querySelector('button[aria-label="Delete pending expense"]')).not.toBeNull();
		expect(container.querySelector('button[aria-label="Discard this entry"]')).not.toBeNull();
	});
});

const CONTROL_TAGS = new Set(['a', 'button', 'Button']);

/**
 * Every `title="…"` set on a control in `source`. The owning tag is found by walking back to the
 * nearest `<`, which is reliable in Svelte markup: an attribute value may hold `=>` but not `<`.
 * A `title` on a `<div>` is a truncation tooltip, not a name, so only controls are collected.
 */
function controlTitles(source: string): string[] {
	return [...source.matchAll(/\btitle="([^"]+)"/g)]
		.filter(match => {
			const tagStart = source.lastIndexOf('<', match.index);
			return CONTROL_TAGS.has(source.slice(tagStart + 1).match(/^[\w.]+/)?.[0] ?? '');
		})
		.map(match => match[1]!);
}

describe('the odometer tab', () => {
	test('pairs every title it sets on a control with a matching aria-label', () => {
		const source = readFileSync(ODOMETER_TAB, 'utf-8');
		const titles = controlTitles(source);

		expect(titles).toEqual(['Edit reading', 'Delete reading']);

		for (const title of titles) {
			expect(source, `title="${title}" is the only name this control has`).toContain(
				`aria-label="${title}"`
			);
		}
	});
});
