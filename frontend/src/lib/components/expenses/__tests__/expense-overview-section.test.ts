import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { Fuel, Wrench } from '@lucide/svelte';
import type { Component } from 'svelte';
import type { ExpenseSummary } from '#lib/types/index.ts';
import ExpenseOverviewSection from '../ExpenseOverviewSection.svelte';

type StatCard = { label: string; value: string; icon: Component; iconColor: string };

const STAT_CARDS: StatCard[] = [
	{ label: 'Total Spent', value: '$1,500.00', icon: Fuel as unknown as Component, iconColor: 'x' },
	{ label: 'This Month', value: '$120.00', icon: Wrench as unknown as Component, iconColor: 'y' }
];

function summary(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
	return {
		totalAmount: 1500,
		expenseCount: 12,
		monthlyAverage: 125,
		recentAmount: 120,
		categoryBreakdown: [
			{ category: 'fuel', amount: 900, count: 8 },
			{ category: 'maintenance', amount: 600, count: 4 }
		],
		monthlyTrend: [],
		costBuckets: { ownershipTotal: 0, runningTotal: 1500, previous: null, byVehicle: [] },
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function expand() {
	await fireEvent.click(screen.getByRole('button', { name: /Expense Overview/ }));
	await settle();
}

afterEach(() => {
	cleanup();
});

describe('ExpenseOverviewSection', () => {
	test('the header summarises total and count', () => {
		render(ExpenseOverviewSection, { props: { summary: summary(), statCards: STAT_CARDS } });
		expect(screen.getByText(/\$1,500\.00 across 12\s+expenses/)).toBeInTheDocument();
	});

	test('a single expense reads in the singular', () => {
		render(ExpenseOverviewSection, {
			props: { summary: summary({ totalAmount: 45, expenseCount: 1 }), statCards: [] }
		});
		expect(screen.getByText(/\$45\.00 across 1\s+expense$/)).toBeInTheDocument();
	});

	test('with no summary yet it shows zero expenses', () => {
		render(ExpenseOverviewSection, { props: { summary: null, statCards: [] } });
		expect(screen.getByText(/\$0\.00 across 0\s+expenses/)).toBeInTheDocument();
	});

	test('is collapsed initially and renders no details until opened', () => {
		render(ExpenseOverviewSection, { props: { summary: summary(), statCards: STAT_CARDS } });
		expect(screen.getByRole('button', { name: /Expense Overview/ })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect(screen.queryByText('Total Spent')).toBeNull();
		expect(screen.queryByText('Expenses by Category')).toBeNull();
	});

	test('collapsing again keeps the details, only hidden', async () => {
		render(ExpenseOverviewSection, { props: { summary: summary(), statCards: STAT_CARDS } });
		await expand();
		await expand();

		expect(screen.getByRole('button', { name: /Expense Overview/ })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect(screen.getByText('Total Spent')).not.toBeVisible();
	});

	test('expanding shows the stat cards and the per-category breakdown', async () => {
		render(ExpenseOverviewSection, { props: { summary: summary(), statCards: STAT_CARDS } });
		await expand();

		expect(screen.getByRole('button', { name: /Expense Overview/ })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect(screen.getByText('Total Spent')).toBeVisible();
		expect(screen.getByText('This Month')).toBeVisible();
		expect(screen.getByText('Expenses by Category')).toBeVisible();
		expect(screen.getByText('Fuel & Charging')).toBeVisible();
		expect(screen.getByText('$900.00')).toBeVisible();
		expect(screen.getByText('Maintenance')).toBeVisible();
		expect(screen.getByText('$600.00')).toBeVisible();
	});

	test('an empty category breakdown omits the category section', async () => {
		render(ExpenseOverviewSection, {
			props: { summary: summary({ categoryBreakdown: [] }), statCards: STAT_CARDS }
		});
		await expand();

		expect(screen.getByText('Total Spent')).toBeVisible();
		expect(screen.queryByText('Expenses by Category')).toBeNull();
	});

	test('a null summary expands to stat cards only', async () => {
		render(ExpenseOverviewSection, { props: { summary: null, statCards: STAT_CARDS } });
		await expand();

		expect(screen.getByText('Total Spent')).toBeVisible();
		expect(screen.queryByText('Expenses by Category')).toBeNull();
	});

	test('expanding twice collapses it again', async () => {
		render(ExpenseOverviewSection, { props: { summary: summary(), statCards: STAT_CARDS } });
		await expand();
		await expand();

		expect(screen.getByRole('button', { name: /Expense Overview/ })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		expect(screen.getByText('Total Spent')).not.toBeVisible();
	});
});
