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

const RETURN_TO = encodeURIComponent('/vehicles/v1');

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

	test('each policy is one row: carrier, number, term, cost and when it renews', async () => {
		onNov23();
		getPoliciesForVehicle.mockResolvedValue([current]);
		mount();
		await settle();

		const row = screen.getByRole('link', { name: /State Farm/ });
		expect(row).toHaveTextContent('#SF123 · Jul 26, 2026 – Jan 24, 2027');
		expect(row).toHaveTextContent('$1,200');
		expect(row).toHaveTextContent('Renews in 62 days');
		expect(row).toHaveAttribute('href', '/insurance/p1/edit?returnTo=/vehicles/v1');
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
		expect(rows[1]).not.toHaveTextContent(/Renews|Ended/);
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

	test('no claims says so', async () => {
		getPoliciesForVehicle.mockResolvedValue([policies[0] as InsurancePolicy]);
		mount();
		await settle();
		expect(screen.getByText('No claims for this car.')).toBeInTheDocument();
	});
});
