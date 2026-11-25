import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import VehicleRowsCard from '../VehicleRowsCard.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params?: Record<string, string>) =>
		path.replace('[id]', params?.['id'] ?? '')
}));

const ROWS = [
	{
		id: 'v1',
		name: 'Daily Driver',
		detail: '2020 Toyota Camry · Financed',
		isElectric: false,
		spend: 500.79,
		runningPerDistance: 0.13,
		trend: [100, 120, 90, 300, 80, 110]
	},
	{
		id: 'v2',
		name: 'Sparky',
		detail: '2023 Tesla Model 3 · Shared by Sam',
		isElectric: true,
		spend: 20.26,
		runningPerDistance: null,
		trend: null
	}
];

describe('VehicleRowsCard', () => {
	test('every vehicle is one row in one list, each a real link to its page', () => {
		render(VehicleRowsCard, {
			props: { rows: ROWS, periodLabel: '30 days', distanceLabel: 'mi' }
		});

		expect(screen.getByRole('list')).toHaveClass('divide-y');
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
		expect(screen.getByRole('link', { name: 'Daily Driver' })).toHaveAttribute(
			'href',
			'/vehicles/v1'
		);
		expect(screen.getByRole('link', { name: 'Sparky' })).toHaveAttribute('href', '/vehicles/v2');
	});

	test('a row shows its spend and running cost per distance, or says there is no distance', () => {
		render(VehicleRowsCard, {
			props: { rows: ROWS, periodLabel: '30 days', distanceLabel: 'mi' }
		});
		const [first, second] = screen.getAllByRole('listitem');

		expect(first?.textContent).toContain('$500.79');
		expect(first?.textContent).toContain('$0.13/mi, 30 days');
		expect(second?.textContent).toContain('No running cost per mi for this period');
	});
});
