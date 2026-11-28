import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { InsurancePolicy, Vehicle } from '#lib/types/index.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

interface PolicyListProps {
	policies: InsurancePolicy[];
	vehicleNameMap: Map<string, string>;
	vehicles: Vehicle[];
	onEdit: (policy: InsurancePolicy) => void;
	onRefresh: () => Promise<void>;
}

const { goto, getAllPolicies, getVehicles, notifyError, policyList } = vi.hoisted(() => ({
	goto: vi.fn<(url: string) => Promise<void>>(),
	getAllPolicies: vi.fn<() => Promise<InsurancePolicy[]>>(),
	getVehicles: vi.fn<() => Promise<Vehicle[]>>(),
	notifyError: vi.fn<(error: unknown, context?: string) => void>(),
	policyList: { latest: null as PolicyListProps | null }
}));

vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({
	resolve: (path: string, params?: Record<string, string>) =>
		params ? path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '') : path
}));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getAllPolicies: () => getAllPolicies() }
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));
vi.mock('#lib/utils/error-handling.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/error-handling.ts')>()),
	handleErrorWithNotification: (error: unknown, context?: string) => notifyError(error, context)
}));
vi.mock('#lib/components/insurance/PolicyList.svelte', () => ({
	default: (_anchor: unknown, props: PolicyListProps) => {
		policyList.latest = props;
	}
}));

const Page = (await import('../+page.svelte')).default;

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
	return {
		id: 'v1',
		make: 'Honda',
		model: 'Civic',
		year: 2021,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function policy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
	return {
		id: 'p1',
		company: 'Acme Mutual',
		isActive: true,
		vehicleIds: ['v1'],
		terms: [],
		termVehicleCoverage: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount() {
	const view = render(Page);
	await settle();
	return view;
}

beforeEach(() => {
	vi.clearAllMocks();
	policyList.latest = null;
	goto.mockResolvedValue();
	getAllPolicies.mockResolvedValue([policy()]);
	getVehicles.mockResolvedValue([vehicle(), vehicle({ id: 'v2', nickname: 'Beater' })]);
});

afterEach(() => {
	cleanup();
});

describe('insurance page loading and errors', () => {
	test('keeps the header and shows skeletons, with no Add Policy, while data loads', async () => {
		getAllPolicies.mockReturnValue(new Promise(() => {}));
		await mount();

		expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
		expect(screen.getByRole('heading', { name: 'Insurance' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Add Policy' })).toBeNull();
	});

	test('a load failure shows one inline error with no toast, and Retry recovers', async () => {
		const error = new ApiError('Gateway timeout', 504);
		getAllPolicies.mockRejectedValueOnce(error);
		await mount();

		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText('Gateway timeout')).toBeNull();
		expect(screen.getByText("Couldn't load insurance")).toBeInTheDocument();
		expect(notifyError).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'Add Policy' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(getAllPolicies).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('Gateway timeout')).toBeNull();
		expect(policyList.latest?.policies).toEqual([policy()]);
	});

	test('a failed vehicle load also shows the error state', async () => {
		getVehicles.mockRejectedValueOnce(new ApiError('Vehicles unavailable', 503));
		await mount();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
	});

	test('a non-Error rejection shows a generic message', async () => {
		getAllPolicies.mockRejectedValueOnce('nope');
		await mount();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeInTheDocument();
	});
});

describe('insurance page empty state', () => {
	test('with no policies it shows the empty state and Add Policy opens the new-policy form', async () => {
		getAllPolicies.mockResolvedValue([]);
		await mount();

		expect(screen.getByText('No insurance policies')).toBeInTheDocument();
		expect(policyList.latest).toBeNull();

		expect(screen.getAllByRole('button', { name: /policy/i })).toHaveLength(1);
		await fireEvent.click(screen.getByRole('button', { name: 'Add Policy' }));
		expect(goto).toHaveBeenCalledWith('/insurance/new');
	});

	test('with no vehicles and no policies it points to Add vehicle and offers no policy button', async () => {
		getAllPolicies.mockResolvedValue([]);
		getVehicles.mockResolvedValue([]);
		await mount();

		expect(screen.getByRole('heading', { name: 'Add a vehicle first' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
		expect(screen.queryByText('No insurance policies')).toBeNull();
		expect(screen.queryByRole('button', { name: /policy/i })).toBeNull();
	});
});

describe('insurance page with policies', () => {
	test('passes policies, vehicles and display names to the policy list', async () => {
		await mount();

		expect(screen.getByRole('heading', { name: 'Insurance' })).toBeInTheDocument();
		const props = policyList.latest;
		expect(props?.policies).toEqual([policy()]);
		expect(props?.vehicles.map(v => v.id)).toEqual(['v1', 'v2']);
		expect(props?.vehicleNameMap.get('v1')).toBe('2021 Honda Civic');
		expect(props?.vehicleNameMap.get('v2')).toBe('Beater');
	});

	test('the header counts policies in force and inactive ones', async () => {
		const { makeTerm } = await import('#lib/components/insurance/__tests__/insurance-fixtures.ts');
		const terms = [makeTerm({ endDate: '2099-01-01' })];
		getAllPolicies.mockResolvedValue([
			policy({ terms }),
			policy({ id: 'p2', isActive: false, terms }),
			policy({ id: 'p3', terms })
		]);
		await mount();
		expect(screen.getByText('2 in force · 1 inactive')).toBeInTheDocument();
	});

	test('editing a policy navigates to its edit page', async () => {
		await mount();
		policyList.latest?.onEdit(policy({ id: 'p42' }));
		expect(goto).toHaveBeenCalledWith('/insurance/p42/edit');
	});

	test('a refresh from the list reloads policies and vehicles', async () => {
		await mount();
		getAllPolicies.mockResolvedValue([policy(), policy({ id: 'p2', company: 'Other' })]);

		await policyList.latest?.onRefresh();
		await settle();

		expect(getAllPolicies).toHaveBeenCalledTimes(2);
		expect(getVehicles).toHaveBeenCalledTimes(2);
		expect(policyList.latest?.policies.map(p => p.id)).toEqual(['p1', 'p2']);
	});

	test('policies left with no vehicles still list, with no Add Policy button', async () => {
		getVehicles.mockResolvedValue([]);
		await mount();

		expect(policyList.latest).not.toBeNull();
		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Add Policy' })).toBeNull();
	});

	test('the header Add Policy button opens the new-policy form at every width', async () => {
		await mount();
		const button = screen.getByRole('button', { name: 'Add Policy' });
		expect(button).not.toHaveClass('hidden');

		await fireEvent.click(button);

		expect(goto).toHaveBeenCalledExactlyOnceWith('/insurance/new');
	});
});
