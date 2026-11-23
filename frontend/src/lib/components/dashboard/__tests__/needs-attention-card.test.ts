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
});
