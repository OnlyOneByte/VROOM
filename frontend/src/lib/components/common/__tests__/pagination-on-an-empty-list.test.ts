// Empty lists show no pagination: the bar never reports fewer than one page, and the table renders no bar for a zero count.

import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import PaginationControls from '../pagination-controls.svelte';
import ExpensesTable from '../../expenses/ExpensesTable.svelte';
import type { Expense } from '$lib/types';

// Mounting needs svelte's client entries; svelte/reactivity matters because its server MediaQuery pins IsMobile to the wide layout.
vi.mock('svelte', () => import('../../../../../node_modules/svelte/src/index-client.js' as string));
vi.mock(
	'svelte/reactivity',
	() => import('../../../../../node_modules/svelte/src/reactivity/index-client.js' as string)
);

describe('the pagination bar itself', () => {
	test('never reports a page count below one', () => {
		const { container } = render(PaginationControls, {
			currentOffset: 0,
			pageSize: 20,
			totalCount: 0,
			onPageChange: () => {}
		});

		expect(container.textContent).not.toContain('of 0');
		expect(container.textContent).toContain('Page 1 of 1');
	});

	test('still counts pages normally when there are rows', () => {
		const { container } = render(PaginationControls, {
			currentOffset: 20,
			pageSize: 20,
			totalCount: 45,
			onPageChange: () => {}
		});

		expect(container.textContent).toContain('Page 2 of 3');
	});
});

describe('the expenses table', () => {
	const PAGING = {
		expenses: [] as Expense[],
		totalCount: 0,
		currentOffset: 0,
		pageSize: 20,
		onPageChange: () => {}
	};

	test('renders no pagination bar when it was handed nothing to page through', () => {
		const { container } = render(ExpensesTable, PAGING);

		expect(container.textContent).not.toContain('Page 1');
		expect(container.querySelectorAll('button')).toHaveLength(0);
	});

	test('renders the bar as soon as there is a row', () => {
		const expense = {
			id: 'e1',
			vehicleId: 'v1',
			userId: 'u1',
			category: 'fuel',
			amount: 45.5,
			date: '2024-03-15T12:00:00.000Z',
			tags: [],
			createdAt: '2024-03-15T12:00:00.000Z',
			updatedAt: '2024-03-15T12:00:00.000Z'
		} as unknown as Expense;

		const { container } = render(ExpensesTable, { ...PAGING, expenses: [expense], totalCount: 1 });

		expect(container.textContent).toContain('Page 1 of 1');
	});
});
