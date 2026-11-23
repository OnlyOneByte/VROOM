import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const DueRemindersCard = (await import('../DueRemindersCard.svelte')).default;

afterEach(() => cleanup());

describe('DueRemindersCard', () => {
	test('with nothing due it is one Coming up row with Add reminder, not a nested empty box', () => {
		render(DueRemindersCard, { props: { reminders: [] } });

		const row = screen.getByTestId('coming-up-empty');
		expect(row).toHaveClass('py-4');
		expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument();
		expect(screen.getByText('Nothing due in the next two weeks')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add reminder' })).toHaveAttribute(
			'href',
			'/reminders'
		);
		expect(screen.queryByText('Upcoming Reminders')).toBeNull();
	});

	test('while loading it keeps the full card with skeleton rows', () => {
		render(DueRemindersCard, { props: { reminders: [], isLoading: true } });
		expect(screen.getByText('Upcoming Reminders')).toBeInTheDocument();
		expect(screen.queryByTestId('coming-up-empty')).toBeNull();
	});

	test('due reminders keep the full list card', () => {
		render(DueRemindersCard, {
			props: {
				reminders: [
					{
						id: 'r1',
						name: 'Oil change',
						nextDueDate: '2026-11-25T00:00:00.000Z',
						isOverdue: false,
						expenseAmount: null,
						vehicleNames: 'Daily Driver'
					}
				]
			}
		});
		expect(screen.getByText('Upcoming Reminders')).toBeInTheDocument();
		expect(screen.getByText('Oil change')).toBeInTheDocument();
	});
});
