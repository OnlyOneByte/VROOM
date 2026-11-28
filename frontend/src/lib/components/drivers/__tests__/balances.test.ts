import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { DriverBalances } from '#lib/types/index.ts';

const balances = vi.fn<() => Promise<DriverBalances | null>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: { balances: () => balances() }
}));

import BalancesCard from '../BalancesCard.svelte';
import { balancesCsv, balancesText } from '../balances-export';

const data = (overrides: Partial<DriverBalances> = {}): DriverBalances => ({
	scope: 'everyone',
	rules: { running: { kind: 'distance' }, ownership: { kind: 'payer' } },
	drivers: [
		{
			driverId: 'a',
			name: 'Alex',
			color: 'chart-1',
			guest: false,
			you: true,
			owed: 60,
			paid: 80,
			balance: -20
		},
		{
			driverId: 's',
			name: '=Sam',
			color: 'chart-2',
			guest: true,
			you: false,
			owed: 20,
			paid: 0,
			balance: 20
		}
	],
	transfers: [{ fromDriverId: 's', fromName: '=Sam', toDriverId: 'a', toName: 'Alex', amount: 20 }],
	total: 80,
	unassigned: 0,
	unpaid: 0,
	...overrides
});

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const mount = () =>
	render(BalancesCard, {
		props: {
			vehicleId: 'car',
			from: new Date('2024-03-01'),
			to: new Date('2024-03-31'),
			description: 'March'
		}
	});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('balances', () => {
	test('shows each balance and who pays whom', async () => {
		balances.mockResolvedValue(data());
		mount();
		await settle();
		expect(screen.getByText('Is owed $20.00')).toBeTruthy();
		expect(screen.getByText('Owes $20.00')).toBeTruthy();
		const list = screen.getByRole('list', { name: 'Who pays whom' });
		expect(list.textContent).toContain('=Sam');
		expect(list.textContent).toContain('$20.00');
		expect(screen.queryByText(/Fill in drivers to include it/)).toBeNull();
	});

	test("says how much isn't anyone's when distance or payers are missing", async () => {
		balances.mockResolvedValue(data({ unassigned: 12.5, unpaid: 2.5 }));
		mount();
		await settle();
		expect(
			screen.getByText(
				/\$12\.50 of costs isn't shared out to anyone yet, and \$2\.50 of costs has no payer/
			)
		).toBeTruthy();
	});

	test('with no cost paid yet, it says how much has no payer instead of "No shared costs"', async () => {
		balances.mockResolvedValue(data({ drivers: [], transfers: [], total: 500, unpaid: 500 }));
		mount();
		await settle();
		expect(
			screen.getByText('$500.00 of costs has no payer recorded. Fill in drivers to include it.')
		).toBeTruthy();
		expect(screen.queryByText('No shared costs in this period yet.')).toBeNull();
	});

	test('with nothing at all in the period, it says there are no shared costs', async () => {
		balances.mockResolvedValue(data({ drivers: [], transfers: [], total: 0 }));
		mount();
		await settle();
		expect(screen.getByText('No shared costs in this period yet.')).toBeTruthy();
	});

	test('a driver who sees only their own balance and owes nothing sees Settled, not "No shared costs"', async () => {
		balances.mockResolvedValue(
			data({
				scope: 'own',
				drivers: [
					{
						driverId: 'a',
						name: 'Alex',
						color: 'chart-1',
						guest: false,
						you: true,
						owed: 0,
						paid: 0,
						balance: 0
					}
				],
				transfers: [],
				total: null,
				unassigned: null,
				unpaid: null
			})
		);
		mount();
		await settle();
		expect(screen.getByText('Settled')).toBeTruthy();
		expect(screen.queryByText('No shared costs in this period yet.')).toBeNull();
	});

	test('a refund with no payer is reported too', async () => {
		balances.mockResolvedValue(data({ unpaid: -15 }));
		mount();
		await settle();
		expect(screen.getByText(/-\$15\.00 of costs has no payer recorded/)).toBeTruthy();
	});

	test('hides itself when the person cannot see balances', async () => {
		balances.mockResolvedValue(null);
		const { container } = mount();
		await settle();
		expect(container.textContent?.trim()).toBe('');
	});

	test('the CSV keeps names safe from spreadsheet formulas, and the text reads as sentences', () => {
		const csv = balancesCsv(data());
		expect(csv).toContain("'=Sam,20,0,20");
		expect(csv).toContain("'=Sam,Alex,20");
		expect(balancesText(data(), 'March')).toBe('=Sam pays Alex $20.00 for March.');
		expect(balancesText(data({ transfers: [] }), 'March')).toBe(
			'Everyone is settled up for March.'
		);
	});
});
