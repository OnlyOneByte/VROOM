import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { FinancingResponse } from '#lib/types/index.ts';

type PieProps = {
	title: string;
	description?: string;
	data: { key: string; value: number }[];
	formatLegendValue?: (item: { key: string; value: number }) => string;
	tooltipFormat?: (value: number, key: string) => string;
};

const { pies } = vi.hoisted(() => ({ pies: [] as PieProps[] }));

vi.mock('#lib/components/charts/index.ts', () => ({
	AppBarChart: () => {},
	AppPieChart: (_anchor: unknown, props: PieProps) => {
		pies.push(props);
	}
}));

const { default: FinancingAnalytics } = await import('../FinancingAnalytics.svelte');

function financing(typeDistribution: FinancingResponse['typeDistribution']): FinancingResponse {
	return {
		summary: {
			totalMonthlyPayments: 350,
			remainingBalance: 12000,
			monthlyInterestEstimate: 40,
			activeCount: 1,
			loanCount: 1,
			leaseCount: 0
		},
		vehicleDetails: [],
		loanBreakdown: [],
		typeDistribution
	} as unknown as FinancingResponse;
}

afterEach(() => {
	cleanup();
	pies.length = 0;
});

describe('Financing Type Distribution', () => {
	test('slices are vehicle counts, so 1 loan and 2 owned vehicles split one third to two thirds', () => {
		render(FinancingAnalytics, {
			props: {
				financing: financing([
					{ type: 'loan', value: 350, count: 1 },
					{ type: 'own', value: 0, count: 2 }
				])
			}
		});
		const pie = pies.find(p => p.title === 'Financing Type Distribution')!;
		expect(pie.description).toBe('Vehicles by financing type');
		expect(pie.data.map(d => [d.key, d.value])).toEqual([
			['loan', 1],
			['own', 2]
		]);
		expect(pie.formatLegendValue?.(pie.data[1]!)).toBe('2 vehicles');
		expect(pie.tooltipFormat?.(1, 'loan')).toBe('1 vehicle');
	});

	test('an all-owned fleet is one full Own slice, not an empty ring', () => {
		render(FinancingAnalytics, {
			props: { financing: financing([{ type: 'own', value: 0, count: 3 }]) }
		});
		const pie = pies.find(p => p.title === 'Financing Type Distribution')!;
		expect(pie.data).toHaveLength(1);
		expect(pie.data[0]).toMatchObject({ key: 'own', value: 3 });
	});
});
