import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { InsuranceResponse } from '#lib/types/index.ts';

vi.mock('#lib/components/charts/index.ts', () => ({
	AppLineChart: () => {},
	AppBarChart: () => {}
}));

const { default: InsuranceAnalytics } = await import('../InsuranceAnalytics.svelte');

function detail(carrier: string, monthlyPremium: number) {
	return {
		vehicleId: 'camry',
		vehicleName: 'Camry',
		carrier,
		monthlyPremium,
		annualPremium: monthlyPremium * 12,
		deductible: null,
		coverageType: null
	};
}

afterEach(cleanup);

describe('Insurance Overview', () => {
	test('one vehicle on two active policies renders both coverage rows', () => {
		const insurance = {
			summary: { totalMonthlyPremiums: 150, totalAnnualPremiums: 1800, activePoliciesCount: 2 },
			vehicleDetails: [detail('Geico', 100), detail('State Farm', 50)],
			monthlyPremiumTrend: [],
			costByCarrier: []
		} as unknown as InsuranceResponse;

		render(InsuranceAnalytics, { props: { insurance } });

		expect(screen.getByText('Insurance Coverage Details')).toBeInTheDocument();
		expect(screen.getByText('Geico')).toBeInTheDocument();
		expect(screen.getByText('State Farm')).toBeInTheDocument();
		expect(screen.getAllByRole('heading', { name: 'Camry', level: 4 })).toHaveLength(2);
	});
});
