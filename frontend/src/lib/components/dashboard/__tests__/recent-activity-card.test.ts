import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RecentActivityCard from '../RecentActivityCard.svelte';
import type { ExpenseCategory } from '#lib/types/index.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

interface RecentExpense {
	id: string;
	amount: number;
	category: ExpenseCategory;
	date: Date;
	description?: string | null;
	vehicleName: string;
}

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * DAY);
}

function rowFor(vehicleName: string): string {
	const row = screen.getByText(vehicleName).closest('.rounded-lg.border');
	return row?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('RecentActivityCard', () => {
	test('shows five skeletons while loading', () => {
		const { container } = render(RecentActivityCard, { expenses: [], isLoading: true });

		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5);
		expect(screen.queryByText('No recent activity')).toBeNull();
	});

	test('shows an empty state with no expenses', () => {
		render(RecentActivityCard, { expenses: [] });

		expect(screen.getByText('No recent activity')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /View All Expenses/ })).toBeNull();
	});

	test('an empty card has one heading, so its empty state is not a peer of its own title', () => {
		render(RecentActivityCard, { expenses: [] });

		expect(screen.getAllByRole('heading').map(h => h.textContent?.trim())).toEqual([
			'No recent activity'
		]);
	});

	test('each row shows category, vehicle, description, relative date and amount', () => {
		render(RecentActivityCard, {
			expenses: [
				{
					id: 'e1',
					amount: 48.2,
					category: 'fuel',
					date: daysAgo(0),
					description: 'Fill-up at Costco',
					vehicleName: 'Camry'
				}
			]
		});

		expect(rowFor('Camry')).toBe('Fuel & Charging Camry Fill-up at Costco Today $48.20');
	});

	test('omits a missing description', () => {
		render(RecentActivityCard, {
			expenses: [
				{
					id: 'e1',
					amount: 300,
					category: 'maintenance',
					date: daysAgo(1),
					description: null,
					vehicleName: 'RAV4'
				}
			]
		});

		expect(rowFor('RAV4')).toBe('Maintenance RAV4 Yesterday $300.00');
	});

	test.each<[number, string]>([
		[3, '3 days ago'],
		[14, '2 weeks ago'],
		[60, '2 months ago'],
		[400, '1 year ago']
	])('an expense %i days old reads "%s"', (days, label) => {
		render(RecentActivityCard, {
			expenses: [
				{ id: 'e1', amount: 1, category: 'misc', date: daysAgo(days), vehicleName: 'Bike' }
			]
		});

		expect(rowFor('Bike')).toContain(label);
	});

	test('links to the expenses page when there is activity', () => {
		const expenses: RecentExpense[] = [
			{ id: 'e1', amount: 1, category: 'misc', date: daysAgo(2), vehicleName: 'Bike' },
			{ id: 'e2', amount: 2, category: 'financial', date: daysAgo(5), vehicleName: 'Van' }
		];
		render(RecentActivityCard, { expenses });

		expect(screen.getByText('Financial')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /View All Expenses/ })).toHaveAttribute(
			'href',
			'/expenses'
		);
	});

	test('View All Expenses is 40px tall below sm and 36px from sm up', () => {
		render(RecentActivityCard, {
			expenses: [{ id: 'e1', amount: 1, category: 'misc', date: daysAgo(2), vehicleName: 'Bike' }]
		});

		expect(screen.getByRole('link', { name: /View All Expenses/ })).toHaveClass('h-10', 'sm:h-9');
	});
	test('the category badge stays on one line and the vehicle name stacks under it on mobile', () => {
		render(RecentActivityCard, {
			expenses: [
				{
					id: 'e1',
					amount: 28.99,
					category: 'fuel',
					date: daysAgo(2),
					description: 'Arco',
					vehicleName: 'Weekend Car'
				}
			]
		});

		const name = screen.getByText('Weekend Car');
		const badge = name.previousElementSibling;
		expect(badge).toHaveClass('whitespace-nowrap', 'shrink-0');
		expect(name.parentElement).toHaveClass('flex-col', 'sm:flex-row');
		expect(name).toHaveClass('truncate', 'min-w-0', 'max-w-full');
	});
});
