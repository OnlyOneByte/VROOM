import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { InsurancePolicy } from '#lib/types/index.ts';
import { makePolicy, makeTerm, settle } from './insurance-fixtures.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));

vi.mock('#lib/services/insurance-api.ts', async () => {
	const fixtures = await import('./insurance-fixtures.ts');
	return {
		insuranceApi: {
			getClaims: vi.fn(() => Promise.resolve([])),
			getEntityDocuments: vi.fn(() => Promise.resolve(fixtures.photoPage([]))),
			getEntityDocumentThumbnailUrl: () => '/thumb',
			deleteTerm: vi.fn(),
			uploadEntityDocument: vi.fn(),
			deleteEntityDocument: vi.fn()
		}
	};
});

vi.mock('#lib/utils/error-handling.ts', () => ({ handleErrorWithNotification: vi.fn() }));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(() => Promise.resolve([])) }
}));

const PolicyList = (await import('../PolicyList.svelte')).default;

const VEHICLE_NAMES = new Map([
	['v1', 'Daily'],
	['v2', '2019 Honda Civic']
]);

function mount(policies: InsurancePolicy[], vehicleNameMap?: Map<string, string>) {
	return render(PolicyList, {
		props: {
			policies,
			vehicleNameMap,
			onEdit: vi.fn(),
			onRefresh: vi.fn(() => Promise.resolve())
		}
	});
}

function sectionHeadings(): string[] {
	return headingOutline()
		.filter(([level]) => level <= 3)
		.map(([, text]) => text);
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('PolicyList grouping', () => {
	const inForce = [makeTerm({ id: 't-now', endDate: '2030-01-01' })];

	test('splits policies into active and inactive sections in that order', async () => {
		mount([
			makePolicy({ id: 'p-old', company: 'Old Co', isActive: false }),
			makePolicy({ id: 'p-new', company: 'New Co', isActive: true, terms: inForce })
		]);
		await settle();
		expect(sectionHeadings()).toEqual(['Active Policies', 'New Co', 'Inactive Policies', 'Old Co']);
	});

	test('omits the inactive section when every policy is active', async () => {
		mount([makePolicy({ company: 'Only Co', terms: inForce })]);
		await settle();
		expect(screen.getByText('Active Policies')).toBeInTheDocument();
		expect(screen.queryByText('Inactive Policies')).toBeNull();
	});

	test('omits the active section when every policy is inactive', async () => {
		mount([makePolicy({ isActive: false })]);
		await settle();
		expect(screen.queryByText('Active Policies')).toBeNull();
		expect(screen.getByText('Inactive Policies')).toBeInTheDocument();
	});

	test('an active policy whose terms have all ended is listed as inactive', async () => {
		mount([
			makePolicy({
				company: 'Lapsed Co',
				terms: [makeTerm({ startDate: '2023-07-01', endDate: '2024-06-30' })]
			})
		]);
		await settle();
		expect(screen.queryByText('Active Policies')).toBeNull();
		expect(sectionHeadings()).toEqual(['Inactive Policies', 'Lapsed Co']);
	});

	test('renders nothing for an empty list', () => {
		mount([]);
		expect(screen.queryAllByRole('heading')).toHaveLength(0);
	});
});

describe('PolicyList vehicle names', () => {
	const currentTerm = makeTerm({ id: 't1', endDate: '2030-01-01' });

	test('maps the policy vehicle ids to names and drops unknown ids', async () => {
		mount(
			[makePolicy({ vehicleIds: ['v1', 'v-gone', 'v2'], terms: [currentTerm] })],
			VEHICLE_NAMES
		);
		await settle();
		expect(screen.getByText('Daily, 2019 Honda Civic')).toBeInTheDocument();
	});

	test('falls back to distinct term coverage vehicles when vehicleIds is missing', async () => {
		const policy = {
			...makePolicy({ terms: [currentTerm] }),
			vehicleIds: undefined,
			termVehicleCoverage: [
				{ termId: 't1', vehicleId: 'v2' },
				{ termId: 't0', vehicleId: 'v2' }
			]
		} as unknown as InsurancePolicy;
		mount([policy], VEHICLE_NAMES);
		await settle();
		expect(screen.getByText('2019 Honda Civic')).toBeInTheDocument();
	});

	test('without a name map no vehicle row is rendered', async () => {
		mount([makePolicy({ vehicleIds: ['v1'], terms: [currentTerm] })]);
		await settle();
		expect(screen.queryByText('Vehicles')).toBeNull();
	});

	test('a policy with neither vehicleIds nor coverage yields no vehicle row', async () => {
		const policy = {
			...makePolicy({ terms: [currentTerm] }),
			vehicleIds: undefined,
			termVehicleCoverage: undefined
		} as unknown as InsurancePolicy;
		mount([policy], VEHICLE_NAMES);
		await settle();
		expect(screen.queryByText('Vehicles')).toBeNull();
	});
});

describe('PolicyList heading levels', () => {
	test('on its own page sections are h2, each company h3 and its parts h4', async () => {
		mount([makePolicy({ company: 'Acme Mutual', terms: [makeTerm({ endDate: '2030-01-01' })] })]);
		await settle();

		expect(headingOutline()).toEqual([
			[2, 'Active Policies'],
			[3, 'Acme Mutual']
		]);
	});

	test('under a page section the whole outline moves down one level', async () => {
		render(PolicyList, {
			props: {
				policies: [
					makePolicy({ company: 'Acme Mutual', terms: [makeTerm({ endDate: '2030-01-01' })] })
				],
				level: 3,
				onEdit: vi.fn(),
				onRefresh: vi.fn(() => Promise.resolve())
			}
		});
		await settle();

		expect(headingOutline()).toEqual([
			[3, 'Active Policies'],
			[4, 'Acme Mutual']
		]);
	});
});

function headingOutline(): Array<[number, string]> {
	return screen
		.getAllByRole('heading')
		.map(h => [Number(h.tagName.slice(1)), h.textContent?.trim() ?? '']);
}
