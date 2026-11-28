import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

type ChartProps = { title: string; y?: unknown; seriesLayout?: string; data?: unknown[] };

const api = vi.hoisted(() => ({
	getCrossVehicle: vi.fn(),
	getFinancing: vi.fn(),
	getInsurance: vi.fn(),
	query: vi.fn((): Promise<unknown> => Promise.resolve({ series: [] }))
}));
const charts = vi.hoisted(() => [] as ChartProps[]);

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: (_: unknown, props: ChartProps) => {
		charts.push(props);
	},
	AppLineChart: (_: unknown, props: ChartProps) => {
		charts.push(props);
	}
}));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: api,
	getDefaultDateRange: () => ({ startDate: 10, endDate: 20, ytdStart: 5 })
}));

import CrossVehicleTab from '../CrossVehicleTab.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	charts.length = 0;
	api.getCrossVehicle.mockResolvedValue({
		monthlyExpenseTrends: [],
		expenseByCategory: [],
		vehicleCostComparison: [],
		fuelEfficiencyComparison: [],
		units: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
	});
	api.getFinancing.mockResolvedValue({
		summary: {
			totalMonthlyPayments: 372.86,
			remainingBalance: 12502.51,
			monthlyInterestEstimate: 46.88,
			activeCount: 1,
			loanCount: 1,
			leaseCount: 0
		},
		vehicleDetails: [],
		monthlyTimeline: [],
		typeDistribution: [],
		loanBreakdown: [{ month: '2026-11', interest: 46.88, principal: 325.98 }]
	});
	api.getInsurance.mockResolvedValue({
		summary: { totalMonthlyPremiums: 350, totalAnnualPremiums: 4200, activePoliciesCount: 2 },
		vehicleDetails: [],
		monthlyPremiumTrend: [{ month: '2026-11', premiums: 350 }],
		costByCarrier: [{ carrier: 'Geico', annualPremium: 1800, vehicleCount: 1 }]
	});
});

describe('Cross-vehicle loan and premium charts', () => {
	test('sit under More detail, the loan chart stacked, with no pie or carrier chart', async () => {
		render(CrossVehicleTab, {});
		const group = await screen.findByText('More detail');
		expect(group.closest('[data-slot="chart-group"]')).toBeTruthy();
		const loan = charts.find(c => c.title === 'Loan payments, next 12 months');
		expect(loan?.seriesLayout).toBe('stack');
		expect(loan?.y).toEqual(['principal', 'interest']);
		expect(charts.find(c => c.title === 'Insurance premiums by month')?.data).toHaveLength(1);
		expect(charts.map(c => c.title)).not.toContain('Cost by Insurance Carrier');
		expect(screen.queryByText('Financing Type Distribution')).toBeNull();
	});

	test('with no cars in Loans, Insurance takes the full width', async () => {
		const { container } = render(CrossVehicleTab, {});
		await screen.findByRole('region', { name: 'Insurance' });
		expect(container.querySelector('[data-loans-insurance]')?.className).not.toContain(
			'md:grid-cols-2'
		);
	});

	test('the Loans and Insurance sections come before More detail', async () => {
		render(CrossVehicleTab, {});
		const insurance = await screen.findByRole('region', { name: 'Insurance' });
		const more = screen.getByText('More detail');
		expect(insurance.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
