import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import type { FinancingResponse, InsuranceResponse } from '#lib/types/index.ts';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params?: Record<string, string>) =>
		params ? path.replace('[id]', params['id'] ?? '') : path
}));

const { default: FinancingAnalytics } = await import('../FinancingAnalytics.svelte');
const { default: InsuranceAnalytics } = await import('../InsuranceAnalytics.svelte');

type Detail = FinancingResponse['vehicleDetails'][number];

const own = (id: string): Detail => ({
	vehicleId: id,
	vehicleName: id,
	financingType: 'own',
	monthlyPayment: 0,
	remainingBalance: 0,
	apr: null,
	monthlyInterestEstimate: 0,
	monthsRemaining: 0
});

const loan: Detail = {
	vehicleId: 'camry',
	vehicleName: 'Daily Driver',
	financingType: 'loan',
	monthlyPayment: 372.86,
	remainingBalance: 12502.51,
	apr: 4.5,
	monthlyInterestEstimate: 46.88,
	monthsRemaining: 36
};

function financing(vehicleDetails: Detail[], loanCount = 1, leaseCount = 0): FinancingResponse {
	const financed = vehicleDetails.filter(v => v.financingType !== 'own');
	return {
		summary: {
			totalMonthlyPayments: financed.reduce((s, v) => s + v.monthlyPayment, 0),
			remainingBalance: financed.reduce((s, v) => s + v.remainingBalance, 0),
			monthlyInterestEstimate: 0,
			activeCount: financed.length,
			loanCount,
			leaseCount
		},
		vehicleDetails,
		monthlyTimeline: [],
		typeDistribution: [],
		loanBreakdown: []
	} as FinancingResponse;
}

const policy = (vehicleId: string, carrier: string, monthly: number, extra = {}) => ({
	vehicleId,
	vehicleName: vehicleId,
	carrier,
	monthlyPremium: monthly,
	annualPremium: monthly * 12,
	deductible: null,
	coverageType: null,
	...extra
});

function insurance(vehicleDetails: ReturnType<typeof policy>[]): InsuranceResponse {
	const monthly = vehicleDetails.reduce((s, v) => s + v.monthlyPremium, 0);
	return {
		summary: {
			totalMonthlyPremiums: monthly,
			totalAnnualPremiums: monthly * 12,
			activePoliciesCount: vehicleDetails.length
		},
		vehicleDetails,
		monthlyPremiumTrend: [],
		costByCarrier: []
	} as InsuranceResponse;
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(cleanup);

describe('Loans', () => {
	test('one sentence and one row per loan; owned cars are one clause', () => {
		render(FinancingAnalytics, {
			props: { financing: financing([loan, own('civic'), own('tesla'), own('prius'), own('f150')]) }
		});
		const section = screen.getByRole('region', { name: 'Loans' });
		expect(text(section)).toContain(
			'You pay $372.86 a month on one loan, with $12,503 left. The other 4 cars are owned outright.'
		);
		const rows = within(section).getAllByRole('listitem');
		expect(rows.map(text)).toEqual([
			'Daily Driver Loan · 4.5% APR · 36 payments to go $372.86/mo $12,503 left'
		]);
		expect(within(rows[0] as HTMLElement).getByRole('link').getAttribute('href')).toBe(
			'/vehicles/camry'
		);
		expect(text(section)).not.toMatch(/Owned outright - No financing/);
	});

	test('with no loans the section says the cars are owned outright and lists nothing', () => {
		render(FinancingAnalytics, {
			props: { financing: financing([own('civic'), own('tesla')], 0) }
		});
		const section = screen.getByRole('region', { name: 'Loans' });
		expect(text(section)).toContain('All 2 cars are owned outright.');
		expect(within(section).queryByRole('list')).toBeNull();
	});

	test('a lease and a loan read as "2 loans and leases"; a lease without APR shows payments only', () => {
		const lease: Detail = {
			...loan,
			vehicleId: 'rav4',
			vehicleName: 'RAV4',
			financingType: 'lease',
			monthlyPayment: 300,
			remainingBalance: 0,
			apr: null,
			monthsRemaining: 1
		};
		render(FinancingAnalytics, { props: { financing: financing([loan, lease], 1, 1) } });
		const section = screen.getByRole('region', { name: 'Loans' });
		expect(text(section)).toContain('on 2 loans and leases');
		expect(text(section)).not.toContain('owned outright');
		const rows = within(section).getAllByRole('listitem').map(text);
		expect(rows[1]).toBe('RAV4 Lease · 1 payment to go $300.00/mo');
	});

	test('with no cars to show (none of yours, or none whose finances you can see), nothing renders', () => {
		render(FinancingAnalytics, { props: { financing: financing([], 0) } });
		expect(screen.queryByRole('region', { name: 'Loans' })).toBeNull();
	});
});

describe('Insurance', () => {
	test('the total once, then one row per policy with its yearly cost', () => {
		render(InsuranceAnalytics, {
			props: {
				insurance: insurance([
					policy('Daily Driver', 'State Farm', 200),
					policy('Weekend Car', 'Geico', 150, { deductible: 500, coverageType: 'Full' })
				])
			}
		});
		const section = screen.getByRole('region', { name: 'Insurance' });
		expect(text(section)).toContain('Insurance is $350.00 a month across 2 cars, $4,200 a year.');
		expect(within(section).getAllByRole('listitem').map(text)).toEqual([
			'State Farm Daily Driver · $2,400 a year $200.00/mo',
			'Geico Weekend Car · $1,800 a year · $500 deductible · Full $150.00/mo'
		]);
		expect(text(section)).not.toMatch(/average across fleet|Deductible —|Coverage —/);
		expect(within(section).getByRole('link', { name: 'All policies' }).getAttribute('href')).toBe(
			'/insurance'
		);
	});

	test('one car on two policies counts as one car and lists both', () => {
		render(InsuranceAnalytics, {
			props: {
				insurance: insurance([policy('Camry', 'Geico', 100), policy('Camry', 'State Farm', 50)])
			}
		});
		const section = screen.getByRole('region', { name: 'Insurance' });
		expect(text(section)).toContain('across one car');
		expect(within(section).getAllByRole('listitem')).toHaveLength(2);
	});

	test('no active policy says so', () => {
		render(InsuranceAnalytics, { props: { insurance: insurance([]) } });
		const section = screen.getByRole('region', { name: 'Insurance' });
		expect(text(section)).toContain('No car here has an active insurance policy.');
		expect(within(section).queryByRole('list')).toBeNull();
	});
});
