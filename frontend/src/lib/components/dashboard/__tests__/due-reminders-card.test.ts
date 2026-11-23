import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const DueRemindersCard = (await import('../DueRemindersCard.svelte')).default;

afterEach(() => cleanup());

describe('DueRemindersCard', () => {
	test('with nothing due it is one Coming Up row with Add reminder, not a nested empty box', () => {
		render(DueRemindersCard, { props: { reminders: [] } });

		const row = screen.getByTestId('coming-up-empty');
		expect(row).toHaveClass('py-4');
		expect(screen.getByRole('heading', { name: 'Coming Up' })).toBeInTheDocument();
		expect(screen.getByText('Nothing due in the next two weeks')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add reminder' })).toHaveAttribute(
			'href',
			'/reminders'
		);
		expect(screen.queryByText('Upcoming Reminders')).toBeNull();
	});

	test('a reload with nothing due stays one compact row, so the card does not grow and collapse', () => {
		render(DueRemindersCard, { props: { reminders: [], isLoading: true } });
		expect(screen.getByTestId('coming-up-empty')).toBeInTheDocument();
		expect(screen.queryByText('Upcoming Reminders')).toBeNull();
	});

	test('a reload with reminders keeps the full card with skeleton rows', () => {
		render(DueRemindersCard, {
			props: {
				isLoading: true,
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
