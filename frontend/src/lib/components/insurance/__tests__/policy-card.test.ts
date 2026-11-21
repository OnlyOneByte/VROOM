import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type {
	InsuranceClaim,
	InsurancePolicy,
	PaginatedResponse,
	Photo,
	Vehicle
} from '#lib/types/index.ts';
import { VEHICLES, makePolicy, makeTerm, photoPage, settle } from './insurance-fixtures.ts';

const goto = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));

const getClaims = vi.fn<(policyId: string) => Promise<InsuranceClaim[]>>();
const getEntityDocuments =
	vi.fn<(entityType: string, entityId: string) => Promise<PaginatedResponse<Photo>>>();
const deleteTerm = vi.fn<(policyId: string, termId: string) => Promise<InsurancePolicy>>();

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getClaims: (policyId: string) => getClaims(policyId),
		getEntityDocuments: (entityType: string, entityId: string) =>
			getEntityDocuments(entityType, entityId),
		deleteTerm: (policyId: string, termId: string) => deleteTerm(policyId, termId),
		getEntityDocumentThumbnailUrl: () => '/thumb',
		uploadEntityDocument: vi.fn(),
		deleteEntityDocument: vi.fn()
	}
}));

const handleErrorWithNotification = vi.fn<(error: unknown, context?: string) => void>();
vi.mock('#lib/utils/error-handling.ts', () => ({
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context)
}));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(() => Promise.resolve([])) }
}));

const PolicyCard = (await import('../PolicyCard.svelte')).default;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-20T12:00:00.000Z');

const CURRENT = makeTerm({
	id: 't-current',
	startDate: '2025-04-01',
	endDate: new Date(NOW.getTime() + 10 * DAY_MS).toISOString(),
	policyNumber: 'POL-42',
	totalCost: 1200
});
const PAST = makeTerm({ id: 't-past', startDate: '2024-04-01', endDate: '2025-04-01' });
const OLDEST = makeTerm({ id: 't-oldest', startDate: '2023-04-01', endDate: '2024-04-01' });

interface MountOptions {
	policy?: InsurancePolicy;
	vehicles?: Vehicle[];
	vehicleNames?: string[];
	readOnly?: boolean;
}

function mount(options: MountOptions = {}) {
	const onEdit = vi.fn<(p: InsurancePolicy) => void>();
	const onRefresh = vi.fn<() => Promise<void>>(() => Promise.resolve());
	const policy = options.policy ?? makePolicy({ terms: [PAST, CURRENT] });
	const result = render(PolicyCard, {
		props: {
			policy,
			vehicles: options.vehicles,
			vehicleNames: options.vehicleNames,
			readOnly: options.readOnly,
			onEdit,
			onRefresh
		}
	});
	return { ...result, onEdit, onRefresh, policy };
}

async function confirmDelete(): Promise<void> {
	await settle();
	await fireEvent.click(
		within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
	);
	await settle();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.clearAllMocks();
	getClaims.mockResolvedValue([]);
	getEntityDocuments.mockResolvedValue(photoPage([]));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('PolicyCard header', () => {
	test('shows the company, latest policy number and expiry countdown', async () => {
		mount();
		await settle();
		expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
		expect(screen.getByText('Policy #POL-42')).toBeInTheDocument();
		expect(screen.getByText('10 days left')).toBeInTheDocument();
		expect(screen.getByText('Current Term')).toBeInTheDocument();
		expect(screen.getByText('$1,200.00')).toBeInTheDocument();
		expect(screen.queryByText('Inactive')).toBeNull();
	});

	test.each([
		['an inactive', 'Inactive', makePolicy({ isActive: false, terms: [CURRENT] })],
		['an expired', 'Expired', makePolicy({ terms: [PAST] })]
	])('%s policy is badged on a muted surface without fading its text', async (_, badge, policy) => {
		const { container } = mount({ policy });
		await settle();
		expect(screen.getByText(badge)).toBeInTheDocument();
		const card = container.querySelector('[data-slot="card"]');
		expect(card).toHaveClass('bg-muted/30');
		expect(card?.className).not.toMatch(/opacity-/);
	});

	test('a policy in force keeps the plain card surface', async () => {
		const { container } = mount();
		await settle();
		expect(container.querySelector('[data-slot="card"]')).not.toHaveClass('bg-muted/30');
	});

	test('a policy with no terms shows no term card, number or countdown', async () => {
		mount({ policy: makePolicy() });
		await settle();
		expect(screen.queryByText('Current Term')).toBeNull();
		expect(screen.queryByText(/Policy #/)).toBeNull();
		expect(screen.queryByText(/days left|Expired/)).toBeNull();
		expect(screen.queryByRole('button', { name: /past term/ })).toBeNull();
	});

	test('the settings button hands the policy to onEdit', async () => {
		const { onEdit, policy } = mount();
		await settle();
		await fireEvent.click(screen.getByTitle('Policy settings'));
		expect(onEdit).toHaveBeenCalledWith(policy);
	});

	test('passes vehicle names through to the current term card', async () => {
		mount({ vehicleNames: ['Daily'] });
		await settle();
		expect(screen.getByText('Vehicles')).toBeInTheDocument();
		expect(screen.getByText('Daily')).toBeInTheDocument();
	});
});

describe('PolicyCard child sections', () => {
	test('loads the policy documents and claims', async () => {
		mount();
		await settle();
		expect(getEntityDocuments).toHaveBeenCalledWith('insurance_policy', 'p1');
		expect(getClaims).toHaveBeenCalledWith('p1');
		expect(screen.getByText('Documents')).toBeInTheDocument();
		expect(screen.getByText('Claims')).toBeInTheDocument();
	});

	test('read-only hides settings, term actions and documents but keeps claims', async () => {
		mount({ readOnly: true });
		await settle();
		expect(screen.queryByTitle('Policy settings')).toBeNull();
		expect(screen.queryByTitle('Edit term')).toBeNull();
		expect(screen.queryByTitle('Delete term')).toBeNull();
		expect(screen.queryByRole('button', { name: /renew/i })).toBeNull();
		expect(getEntityDocuments).not.toHaveBeenCalled();
		expect(getClaims).toHaveBeenCalledWith('p1');
		expect(screen.queryByRole('button', { name: /file claim/i })).toBeNull();
	});
});

describe('PolicyCard term history', () => {
	test('a single past term uses the singular label', async () => {
		mount();
		await settle();
		expect(screen.getByRole('button', { name: '1 past term' })).toBeInTheDocument();
		expect(screen.queryByText('Past Terms')).toBeNull();
	});

	test('expanding shows notes and past terms; collapsing hides them again', async () => {
		mount({
			policy: makePolicy({ notes: 'Multi-car discount', terms: [OLDEST, CURRENT, PAST] }),
			vehicles: VEHICLES
		});
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '2 past terms' }));
		expect(screen.getByText('Notes')).toBeInTheDocument();
		expect(screen.getByText('Multi-car discount')).toBeInTheDocument();
		expect(screen.getByText('Past Terms')).toBeInTheDocument();
		expect(screen.getAllByText('Past Term')).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: 'Hide History' }));
		expect(screen.queryByText('Past Terms')).toBeNull();
		expect(screen.getByRole('button', { name: '2 past terms' })).toBeInTheDocument();
	});

	test('expanded history without notes omits the notes block', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '1 past term' }));
		expect(screen.getByText('Past Terms')).toBeInTheDocument();
		expect(screen.queryByText('Notes')).toBeNull();
	});
});

describe('PolicyCard term actions', () => {
	test('editing the current term navigates to its edit route', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByTitle('Edit term'));
		expect(goto).toHaveBeenCalledWith('/insurance/p1/terms/t-current/edit');
	});

	test('renew navigates to the new-term route seeded from the latest term', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /renew/i }));
		await settle();
		expect(goto).toHaveBeenCalledWith('/insurance/p1/terms/new?renewFrom=t-current');
	});

	test('deleting the current term calls the API then refreshes', async () => {
		deleteTerm.mockResolvedValue(makePolicy());
		const { onRefresh } = mount();
		await settle();
		await fireEvent.click(screen.getByTitle('Delete term'));
		await confirmDelete();
		expect(deleteTerm).toHaveBeenCalledWith('p1', 't-current');
		expect(onRefresh).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('deleting a past term from the history uses the same flow', async () => {
		deleteTerm.mockResolvedValue(makePolicy());
		const { onRefresh } = mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: '1 past term' }));
		await fireEvent.click(screen.getAllByTitle('Delete term').at(-1)!);
		await confirmDelete();
		expect(deleteTerm).toHaveBeenCalledWith('p1', 't-past');
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	test('a failed term delete notifies and skips the refresh', async () => {
		const failure = new Error('in use');
		deleteTerm.mockRejectedValue(failure);
		const { onRefresh } = mount();
		await settle();
		await fireEvent.click(screen.getByTitle('Delete term'));
		await confirmDelete();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, 'Failed to delete term');
		expect(onRefresh).not.toHaveBeenCalled();
	});
});
