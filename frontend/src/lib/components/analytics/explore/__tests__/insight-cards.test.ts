import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { AnalyticsInsight } from '#lib/types/index.ts';

const api = vi.hoisted(() => ({ insights: vi.fn() }));
vi.mock('#lib/services/analytics-api.ts', () => ({ analyticsApi: api }));

import InsightCards from '../InsightCards.svelte';

const RANGE = { startDate: 100, endDate: 200, ytdStart: 50 };

function insight(overrides: Partial<AnalyticsInsight>): AnalyticsInsight {
	return {
		id: 'recordMonth',
		title: 'Record month',
		value: 350,
		unit: 'money',
		sentence: 'June 2025 cost the most in this period.',
		query: { metric: 'cost', per: 'month', sel: '2025-06' },
		...overrides
	};
}

beforeEach(() => vi.clearAllMocks());

describe('InsightCards', () => {
	test('shows up to four cards with their value, sentence and link', async () => {
		api.insights.mockResolvedValue([
			insight({}),
			insight({ id: 'repairFree', title: 'Repair-free streak', value: 150, unit: 'days' }),
			insight({ id: 'winterPenalty', title: 'Winter penalty', value: 33, unit: 'percent' }),
			insight({
				id: 'cheapestStation',
				title: 'Cheapest station',
				value: 3,
				unit: 'moneyPerVolume'
			}),
			insight({ id: 'costPerTrip', title: 'Cost per trip', value: 1.6 })
		]);
		const onApply = vi.fn();
		render(InsightCards, { dateRange: RANGE, vehicleIds: ['camry'], onApply });

		expect(await screen.findByRole('heading', { name: 'Things we noticed' })).toBeInTheDocument();
		expect(api.insights).toHaveBeenCalledWith(
			{ start: 100, end: 200, vehicleIds: ['camry'] },
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
		expect(screen.getAllByRole('listitem')).toHaveLength(4);
		expect(screen.getByText('$350.00')).toBeInTheDocument();
		expect(screen.getByText('150 days')).toBeInTheDocument();
		expect(screen.getByText('33%')).toBeInTheDocument();
		expect(screen.getByText('$3.00/gal')).toBeInTheDocument();
		expect(screen.queryByText('Cost per trip')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Show in Chart: Record month' }));
		expect(onApply).toHaveBeenCalledWith({ metric: 'cost', per: 'month', sel: '2025-06' });
	});

	test('asks again only when the range or the cars change', async () => {
		api.insights.mockResolvedValue([insight({})]);
		const props = { dateRange: RANGE, vehicleIds: ['camry'], onApply: vi.fn() };
		const { rerender } = render(InsightCards, props);
		await screen.findByText('$350.00');
		await rerender({ ...props, dateRange: { ...RANGE }, vehicleIds: ['camry'] });
		await new Promise(r => setTimeout(r, 0));
		expect(api.insights).toHaveBeenCalledTimes(1);
		await rerender({ ...props, dateRange: { ...RANGE, startDate: 150 } });
		await waitFor(() => expect(api.insights).toHaveBeenCalledTimes(2));
	});

	test('renders nothing when there is nothing to say or the request fails', async () => {
		api.insights.mockResolvedValue([]);
		const { container } = render(InsightCards, { dateRange: RANGE, onApply: vi.fn() });
		await waitFor(() => expect(api.insights).toHaveBeenCalled());
		expect(container.querySelector('section')).toBeNull();

		api.insights.mockRejectedValue(new Error('down'));
		const failed = render(InsightCards, { dateRange: RANGE, onApply: vi.fn() });
		await waitFor(() => expect(api.insights).toHaveBeenCalledTimes(2));
		expect(failed.container.querySelector('section')).toBeNull();
	});
});
