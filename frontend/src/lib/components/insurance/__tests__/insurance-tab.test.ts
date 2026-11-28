import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { InsuranceClaim, InsurancePolicy } from '#lib/types/index.ts';
import { makeClaim, makePolicy, makeTerm, settle } from './insurance-fixtures.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';

const goto = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));

const getPoliciesForVehicle = vi.fn<(vehicleId: string) => Promise<InsurancePolicy[]>>();
const getClaims = vi.fn<(policyId: string) => Promise<InsuranceClaim[]>>();

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getPoliciesForVehicle: (vehicleId: string) => getPoliciesForVehicle(vehicleId),
		getClaims: (policyId: string) => getClaims(policyId)
	}
}));

const handleErrorWithNotification = vi.fn<(error: unknown, context?: string) => void>();
vi.mock('#lib/utils/error-handling.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/error-handling.ts')>()),
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context)
}));

const InsuranceTab = (await import('../InsuranceTab.svelte')).default;

const RETURN_TO = encodeURIComponent('/vehicles/v1?tab=insurance');

function mount(readOnly = false) {
	return render(InsuranceTab, { props: { vehicleId: 'v1', readOnly } });
}

beforeEach(() => {
	vi.clearAllMocks();
	getPoliciesForVehicle.mockResolvedValue([]);
	getClaims.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('InsuranceTab load states', () => {
	test('shows a skeleton while policies load', async () => {
		getPoliciesForVehicle.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();
		expect(getPoliciesForVehicle).toHaveBeenCalledWith('v1');
		expect(screen.getByTestId('insurance-tab-loading')).toBeInTheDocument();
		expect(screen.queryByText('No insurance policies')).toBeNull();
	});

	test('shows the error with a retry that reloads successfully', async () => {
		const failure = new ApiError('Server unavailable', 503);
		getPoliciesForVehicle.mockRejectedValueOnce(failure);
		getPoliciesForVehicle.mockResolvedValueOnce([makePolicy()]);
		mount();
		await settle();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText('Server unavailable')).toBeNull();
		expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this car's insurance");
		expect(handleErrorWithNotification).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(getPoliciesForVehicle).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('Server unavailable')).toBeNull();
		expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
	});

	test('a non-Error rejection shows the generic message', async () => {
		getPoliciesForVehicle.mockRejectedValueOnce({ status: 500 });
		mount();
		await settle();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeInTheDocument();
	});
});

describe('InsuranceTab empty state', () => {
	test('invites the owner to add a first policy', async () => {
		mount();
		await settle();
		expect(screen.getByText('No insurance policies')).toBeInTheDocument();
		expect(screen.getByText(/Add your first insurance policy/)).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
		expect(goto).toHaveBeenCalledWith(`/insurance/new?vehicleId=v1&returnTo=${RETURN_TO}`);
	});

	test('read-only viewers get a neutral message and no add button', async () => {
		mount(true);
		await settle();
		expect(screen.getByText('This vehicle has no insurance policies.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /add policy/i })).toBeNull();
	});
});

describe('InsuranceTab policies', () => {
	const current = makePolicy({
		id: 'p1',
		company: 'State Farm',
		terms: [
			makeTerm({
				id: 't1',
				policyId: 'p1',
				policyNumber: 'SF123',
				startDate: '2026-07-26',
				endDate: '2027-01-24',
				totalCost: 1200
			})
		]
	});
	const lapsed = makePolicy({
		id: 'p2',
		company: 'Old Mutual',
		isActive: false,
		terms: [makeTerm({ id: 't2', policyId: 'p2', endDate: '2026-01-01', monthlyCost: 90 })]
	});

	function onNov23() {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 23, 12));
	}

	test('with the next term already added, the row shows the term in force today, and it is not a past term', async () => {
		onNov23();
		const renewed = makePolicy({
			id: 'p6',
			company: 'State Farm',
			terms: [
				makeTerm({
					id: 'now',
					policyId: 'p6',
					startDate: '2026-07-26',
					endDate: '2027-01-24',
					totalCost: 1200
				}),
				makeTerm({
					id: 'next',
					policyId: 'p6',
					startDate: '2027-01-24',
					endDate: '2027-07-24',
					totalCost: 1250
				}),
				makeTerm({
					id: 'old',
					policyId: 'p6',
					startDate: '2026-01-26',
					endDate: '2026-07-26',
					totalCost: 1150
				})
			]
		});
		getPoliciesForVehicle.mockResolvedValue([renewed]);
		mount();
		await settle();

		const row = screen.getByRole('link', { name: /State Farm/ });
		expect(row).toHaveTextContent('Jul 26, 2026 – Jan 24, 2027');
		expect(row).toHaveTextContent('$1,200.00');
		expect(row).toHaveTextContent('Next term from Jan 24, 2027');

		await fireEvent.click(screen.getByRole('button', { name: 'Show 1 past term' }));
		const past = screen.getByRole('list', { name: 'Past terms' });
		expect(past).toHaveTextContent('Jan 26, 2026 – Jul 26, 2026');
		expect(past).not.toHaveTextContent('Jan 24, 2027');
	});

	test('notes sit under the row, outside its link', async () => {
		getPoliciesForVehicle.mockResolvedValue([
			makePolicy({ id: 'p7', notes: 'Agent: Pat, 555-0100', terms: [makeTerm()] })
		]);
		mount();
		await settle();

		const link = screen.getByRole('link', { name: /Acme Mutual/ });
		expect(link).not.toHaveTextContent('Agent: Pat');
		expect(screen.getByText('Agent: Pat, 555-0100')).toBeInTheDocument();
	});

	test('each policy is one row: carrier, number, term, cost and when it renews', async () => {
		onNov23();
		getPoliciesForVehicle.mockResolvedValue([current]);
		mount();
		await settle();

		const row = screen.getByRole('link', { name: /State Farm/ });
		expect(row).toHaveTextContent('#SF123 · Jul 26, 2026 – Jan 24, 2027');
		expect(row).toHaveTextContent('$1,200');
		expect(row).toHaveTextContent('Renews in 62 days');
		expect(row).toHaveAttribute('href', `/insurance/p1/edit?returnTo=${RETURN_TO}`);
		expect(screen.queryAllByRole('button', { name: /settings|renew|claim|upload/i })).toHaveLength(
			0
		);
	});

	test('policies in force come first; one no longer in force says Inactive and has no renewal', async () => {
		onNov23();
		getPoliciesForVehicle.mockResolvedValue([lapsed, current]);
		mount();
		await settle();

		const rows = within(screen.getByRole('region', { name: 'Policies' })).getAllByRole('listitem');
		expect(rows.map(r => r.textContent?.match(/State Farm|Old Mutual/)?.[0])).toEqual([
			'State Farm',
			'Old Mutual'
		]);
		expect(rows[1]).toHaveTextContent('Inactive');
		expect(rows[1]).toHaveTextContent('$90.00/mo');
		expect(rows[1]).not.toHaveTextContent(/Renews|Expired/);
	});

	test('an active policy whose terms have all ended says Expired in red, and renewal within 30 days is amber', async () => {
		onNov23();
		const expired = makePolicy({
			id: 'p3',
			company: 'Lapsed Co',
			terms: [makeTerm({ id: 't3', policyId: 'p3', endDate: '2026-11-01' })]
		});
		const soon = makePolicy({
			id: 'p4',
			company: 'Soon Co',
			terms: [makeTerm({ id: 't4', policyId: 'p4', endDate: '2026-12-13' })]
		});
		getPoliciesForVehicle.mockResolvedValue([expired, soon]);
		mount();
		await settle();

		const expiredStatus = screen.getByText('Expired Nov 1, 2026');
		expect(expiredStatus).toHaveClass('text-destructive');
		expect(screen.getByText('Renews in 20 days')).toHaveClass('text-warning');
	});

	test('viewers see coverage, notes and past terms without leaving the tab', async () => {
		const withHistory = makePolicy({
			id: 'p5',
			company: 'State Farm',
			notes: 'Agent: Pat, 555-0100',
			terms: [
				makeTerm({
					id: 'new',
					policyId: 'p5',
					startDate: '2026-07-26',
					endDate: '2027-01-24',
					coverageDescription: 'Liability 100/300/100',
					deductibleAmount: 500
				}),
				makeTerm({
					id: 'old',
					policyId: 'p5',
					startDate: '2026-01-26',
					endDate: '2026-07-26',
					totalCost: 1150
				})
			]
		});
		getPoliciesForVehicle.mockResolvedValue([withHistory]);
		mount(true);
		await settle();

		expect(screen.getByText('Liability 100/300/100 · $500.00 deductible')).toBeInTheDocument();
		expect(screen.getByText('Agent: Pat, 555-0100')).toBeInTheDocument();
		const toggle = screen.getByRole('button', { name: 'Show 1 past term' });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(toggle);
		const past = screen.getByRole('list', { name: 'Past terms' });
		expect(past).toHaveTextContent('Jan 26, 2026 – Jul 26, 2026');
		expect(past).toHaveTextContent('$1,150.00');
		expect(screen.getByRole('button', { name: 'Hide past terms' })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	});

	test('the tab outline is two h2 sections, and Add policy keeps the return path', async () => {
		getPoliciesForVehicle.mockResolvedValue([current]);
		mount();
		await settle();

		expect(screen.getAllByRole('heading').map(h => [h.tagName, h.textContent?.trim()])).toEqual([
			['H2', 'Policies'],
			['H2', 'Claims']
		]);
		await fireEvent.click(screen.getByRole('button', { name: 'Add policy' }));
		expect(goto).toHaveBeenCalledWith(`/insurance/new?vehicleId=v1&returnTo=${RETURN_TO}`);
		expect(screen.getByRole('link', { name: 'Insurance page' })).toHaveAttribute(
			'href',
			'/insurance'
		);
	});

	test('read-only viewers see plain rows with no links or add button', async () => {
		getPoliciesForVehicle.mockResolvedValue([current]);
		mount(true);
		await settle();

		expect(screen.getByText('State Farm')).toBeInTheDocument();
		expect(screen.queryAllByRole('link')).toHaveLength(0);
		expect(screen.queryByRole('button', { name: /add policy/i })).toBeNull();
	});
});

describe('InsuranceTab claims', () => {
	const policies = [makePolicy({ id: 'p1' }), makePolicy({ id: 'p2', company: 'Other Co' })];

	test("lists this car's claims across its policies, newest first, without other cars' claims", async () => {
		getPoliciesForVehicle.mockResolvedValue(policies);
		getClaims.mockImplementation(async id =>
			id === 'p1'
				? [
						makeClaim({
							id: 'c1',
							claimDate: dateOnlyToISO('2026-03-15'),
							vehicleId: 'v1',
							description: 'Windshield chip repair',
							claimType: 'weather',
							status: 'settled',
							payoutAmount: 120
						}),
						makeClaim({ id: 'c2', vehicleId: 'v2', description: 'Other car' })
					]
				: [makeClaim({ id: 'c3', claimDate: dateOnlyToISO('2026-08-04'), status: 'filed' })]
		);
		mount();
		await settle();

		const rows = within(screen.getByRole('region', { name: 'Claims' })).getAllByRole('listitem');
		expect(rows.map(r => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Collision Aug 4, 2026 · Filed',
			'Windshield chip repair Mar 15, 2026 · Settled · Weather $120.00'
		]);
	});

	test('a claims failure shows inline under Claims, and Retry reloads only the claims', async () => {
		getPoliciesForVehicle.mockResolvedValue([policies[0] as InsurancePolicy]);
		getClaims.mockRejectedValueOnce(new ApiError('down', 503));
		getClaims.mockResolvedValueOnce([makeClaim()]);
		mount();
		await settle();

		const claims = screen.getByRole('region', { name: 'Claims' });
		expect(within(claims).getByText("Couldn't load this car's claims")).toBeInTheDocument();
		await fireEvent.click(within(claims).getByRole('button', { name: 'Retry' }));
		await settle();

		expect(getPoliciesForVehicle).toHaveBeenCalledTimes(1);
		expect(within(claims).getByText('Collision')).toBeInTheDocument();
	});

	test('while claims load the section shows a placeholder, never "No claims"', async () => {
		getPoliciesForVehicle.mockResolvedValue([policies[0] as InsurancePolicy]);
		getClaims.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();

		expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
		expect(screen.getByTestId('claims-loading')).toBeInTheDocument();
		expect(screen.queryByText('No claims for this car.')).toBeNull();
	});

	test('a claims retry keeps the error card up until the reload answers', async () => {
		getPoliciesForVehicle.mockResolvedValue([policies[0] as InsurancePolicy]);
		getClaims.mockRejectedValueOnce(new ApiError('down', 503));
		let answer: (claims: InsuranceClaim[]) => void = () => {};
		getClaims.mockReturnValueOnce(new Promise(resolve => (answer = resolve)));
		mount();
		await settle();

		const claims = screen.getByRole('region', { name: 'Claims' });
		await fireEvent.click(within(claims).getByRole('button', { name: 'Retry' }));
		await settle();
		expect(within(claims).getByText("Couldn't load this car's claims")).toBeInTheDocument();
		expect(within(claims).queryByText('No claims for this car.')).toBeNull();

		answer([]);
		await settle();
		expect(within(claims).queryByText("Couldn't load this car's claims")).toBeNull();
		expect(within(claims).getByText('No claims for this car.')).toBeInTheDocument();
	});

	test('no claims says so', async () => {
		getPoliciesForVehicle.mockResolvedValue([policies[0] as InsurancePolicy]);
		mount();
		await settle();
		expect(screen.getByText('No claims for this car.')).toBeInTheDocument();
	});
});
