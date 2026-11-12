import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import OfflineExpenseCards from '../expenses/OfflineExpenseCards.svelte';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

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
			if (button.textContent?.trim()) continue;
			expect(
				button.getAttribute('aria-label'),
				`icon-only control named only by title="${button.getAttribute('title')}"`
			).toBeTruthy();
		}

		expect(container.querySelector('button[aria-label="Delete pending expense"]')).not.toBeNull();
		expect(container.querySelector('button[aria-label="Discard this entry"]')).not.toBeNull();
	});
});

const CONTROL_TAGS = new Set(['a', 'button', 'Button']);

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
