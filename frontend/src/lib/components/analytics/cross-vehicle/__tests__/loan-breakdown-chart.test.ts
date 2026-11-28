import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { FinancingResponse } from '#lib/types/index.ts';

type BarProps = { title: string; y?: unknown; seriesLayout?: string };

const { bars } = vi.hoisted(() => ({ bars: [] as BarProps[] }));

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: (_anchor: unknown, props: BarProps) => {
		bars.push(props);
	},
	AppPieChart: () => {}
}));

const { default: FinancingAnalytics } = await import('../FinancingAnalytics.svelte');

const financing = {
	summary: {
		totalMonthlyPayments: 372.86,
		remainingBalance: 12502.51,
		monthlyInterestEstimate: 46.88,
		activeCount: 1,
		loanCount: 1,
		leaseCount: 0
	},
	vehicleDetails: [],
	loanBreakdown: [
		{ month: '2026-11', interest: 46.88, principal: 325.98 },
		{ month: '2026-12', interest: 45.66, principal: 327.2 }
	],
	typeDistribution: []
} as unknown as FinancingResponse;

afterEach(() => {
	cleanup();
	bars.length = 0;
});

describe('Loan payment breakdown', () => {
	test('stacks principal on interest, so each bar is the whole payment', () => {
		render(FinancingAnalytics, { props: { financing } });
		const chart = bars.find(b => b.title === 'Loan Payment Breakdown');
		expect(chart?.y).toEqual(['principal', 'interest']);
		expect(chart?.seriesLayout).toBe('stack');
	});
});
