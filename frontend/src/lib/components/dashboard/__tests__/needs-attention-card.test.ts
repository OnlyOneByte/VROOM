import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import NeedsAttentionCard from '../NeedsAttentionCard.svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

describe('NeedsAttentionCard', () => {
	test('each item links to where it is handled and says how urgent it is in words', () => {
		render(NeedsAttentionCard, {
			props: {
				items: [
					{
						id: 'r',
						title: 'Oil change · Daily Driver',
						detail: 'Was due Nov 20',
						status: 'overdue',
						dueAt: 1,
						href: 'reminders'
					},
					{
						id: 'p',
						title: 'State Farm renewal',
						detail: 'Ends Jan 2',
						status: 'soon',
						dueAt: 2,
						href: 'insurance'
					}
				]
			}
		});

		expect(screen.getByRole('link', { name: 'Oil change · Daily Driver' })).toHaveAttribute(
			'href',
			'/reminders'
		);
		expect(screen.getByRole('link', { name: 'State Farm renewal' })).toHaveAttribute(
			'href',
			'/insurance'
		);
		expect(screen.getByText('Overdue')).toBeInTheDocument();
		expect(screen.getByText('Soon')).toBeInTheDocument();
	});

	test('with nothing to show it renders nothing', () => {
		const { container } = render(NeedsAttentionCard, { props: { items: [] } });
		expect(container.textContent?.trim()).toBe('');
	});

	test('can carry its own title and a "Log it" action on a row', () => {
		render(NeedsAttentionCard, {
			props: {
				title: 'Next up',
				items: [
					{
						id: 'r',
						title: 'Oil change',
						detail: 'Was due Nov 20',
						status: 'overdue',
						dueAt: 1,
						href: 'reminders',
						action: { label: 'Log it', href: '/expenses/new?vehicleId=v1' }
					}
				]
			}
		});

		expect(screen.getByRole('heading', { name: 'Next up' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Log it: Oil change' })).toHaveAttribute(
			'href',
			'/expenses/new?vehicleId=v1'
		);
	});

	test('with showAll, says how many are due and soon and links to all reminders; without it, neither', () => {
		const items = [
			{
				id: 'a',
				title: 'Oil change',
				detail: '',
				status: 'overdue' as const,
				dueAt: 1,
				href: 'reminders' as const
			},
			{
				id: 'b',
				title: 'Tires',
				detail: '',
				status: 'soon' as const,
				dueAt: 2,
				href: 'reminders' as const
			},
			{
				id: 'c',
				title: 'Plates',
				detail: '',
				status: 'soon' as const,
				dueAt: 3,
				href: 'reminders' as const
			}
		];
		const { unmount } = render(NeedsAttentionCard, { props: { items, showAll: true } });
		expect(screen.getByRole('heading', { name: 'Needs you' })).toBeInTheDocument();
		expect(screen.getByText('· 1 due, 2 soon')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'All reminders' })).toHaveAttribute(
			'href',
			'/reminders'
		);
		unmount();

		render(NeedsAttentionCard, { props: { items, title: 'Next up' } });
		expect(screen.queryByText(/1 due/)).toBeNull();
		expect(screen.queryByRole('link', { name: 'All reminders' })).toBeNull();
	});
});
