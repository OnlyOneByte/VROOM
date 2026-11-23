import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { InsuranceResponse } from '#lib/types/index.ts';

vi.mock('#lib/components/charts/index.ts', () => ({
	AppLineChart: () => {},
	AppBarChart: () => {}
}));

const { default: InsuranceAnalytics } = await import('../InsuranceAnalytics.svelte');

function detail(vehicleId: string, carrier: string) {
	return {
		vehicleId,
		vehicleName: vehicleId,
		carrier,
		monthlyPremium: 50,
		annualPremium: 600,
		deductible: null,
		coverageType: null
	};
}

function insurance(
	activePoliciesCount: number,
	vehicleDetails: ReturnType<typeof detail>[]
): InsuranceResponse {
	return {
		summary: { totalMonthlyPremiums: 100, totalAnnualPremiums: 1200, activePoliciesCount },
		vehicleDetails,
		monthlyPremiumTrend: [],
		costByCarrier: []
	} as unknown as InsuranceResponse;
}

afterEach(cleanup);

describe('Active Policies tile', () => {
	test('one policy covering two cars reads "1" and "covering 2 vehicles"', () => {
		render(InsuranceAnalytics, {
			props: { insurance: insurance(1, [detail('camry', 'Geico'), detail('civic', 'Geico')]) }
		});
		expect(screen.getByText('covering 2 vehicles')).toBeInTheDocument();
		expect(screen.queryByText('vehicles insured')).toBeNull();
	});

	test('two policies on two cars read "2" and "covering 2 vehicles"', () => {
		render(InsuranceAnalytics, {
			props: { insurance: insurance(2, [detail('camry', 'Geico'), detail('civic', 'State Farm')]) }
		});
		expect(screen.getByText('covering 2 vehicles')).toBeInTheDocument();
	});

	test('one car reads "covering 1 vehicle"', () => {
		render(InsuranceAnalytics, {
			props: { insurance: insurance(1, [detail('camry', 'Geico')]) }
		});
		expect(screen.getByText('covering 1 vehicle')).toBeInTheDocument();
	});
});
