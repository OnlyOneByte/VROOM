import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type {
	InsuranceClaim,
	InsurancePolicy,
	PaginatedResponse,
	Photo,
	Vehicle
} from '#lib/types/index.ts';
import {
	VEHICLES,
	chooseTermAction,
	makeClaim,
	makePhoto,
	makePolicy,
	makeTerm,
	photoPage,
	settle
} from './insurance-fixtures.ts';

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
		updateClaim: vi.fn(() => Promise.resolve({})),
		getEntityDocumentThumbnailUrl: () => '/thumb',
		uploadEntityDocument: vi.fn(),
		deleteEntityDocument: vi.fn()
	}
}));

const handleErrorWithNotification = vi.fn<(error: unknown, context?: string) => void>();
vi.mock('#lib/utils/error-handling.ts', () => ({
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context),
	logLoadFailure: vi.fn(),
	userFacingErrorMessage: () => 'Something went wrong.'
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
	])('%s policy is badged, not tinted or faded', async (_, badge, policy) => {
		const { container } = mount({ policy });
		await settle();
		expect(screen.getByText(badge)).toBeInTheDocument();
		const card = container.querySelector('[data-slot="card"]');
		expect(card).toHaveAttribute('data-in-force', 'false');
		expect(card?.className).not.toMatch(/opacity-|bg-muted/);
	});

	test('a policy in force keeps the plain card surface', async () => {
		const { container } = mount();
		await settle();
		expect(container.querySelector('[data-slot="card"]')).toHaveAttribute('data-in-force', 'true');
		expect(container.querySelector('[data-slot="card"]')).toHaveClass('py-0');
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
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent('0 documents · 0 claims');
		expect(screen.queryByRole('heading', { name: 'Documents' })).toBeNull();
		expect(screen.queryByRole('heading', { name: 'Claims' })).toBeNull();
		expect(screen.queryByText('No documents uploaded yet.')).toBeNull();
		expect(screen.queryByText('No claims filed.')).toBeNull();
	});

	test('a section opens only once it has items, and the footer counts them', async () => {
		getEntityDocuments.mockResolvedValue(photoPage([makePhoto()]));
		getClaims.mockResolvedValue([makeClaim()]);
		mount();
		await settle();
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent('1 document · 1 claim');
		expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Claims' })).toBeInTheDocument();
	});

	test('File Claim in the footer opens the claim form and hides itself', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'File Claim' }));
		await settle();
		expect(screen.getByText('File a claim')).toBeInTheDocument();
		const fileClaim = screen.getAllByRole('button', { name: 'File Claim' });
		expect(fileClaim).toHaveLength(1);
		expect(fileClaim[0]).toHaveAttribute('type', 'submit');
	});

	test('Upload in the footer opens the document capture dialog', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
		await settle();
		expect(screen.getByRole('dialog', { name: 'Upload Documents' })).toBeInTheDocument();
	});

	test('a failed documents load shows Retry on the card, and Retry loads them', async () => {
		getEntityDocuments.mockRejectedValueOnce(new Error('offline'));
		mount();
		await settle();
		expect(screen.getByText("Couldn't load the documents")).toBeInTheDocument();
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent(/^0 claims$/);

		getEntityDocuments.mockResolvedValue(photoPage([makePhoto()]));
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(screen.queryByText("Couldn't load the documents")).toBeNull();
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent('1 document · 0 claims');
	});

	test.each([
		['documents', "Couldn't load the documents"],
		['claims', 'Something went wrong.']
	])(
		'Retry on a failed %s load stays on screen and focusable while it runs',
		async (kind, message) => {
			const failing = kind === 'documents' ? getEntityDocuments : getClaims;
			failing.mockRejectedValueOnce(new Error('offline'));
			mount();
			await settle();
			if (kind === 'documents') getEntityDocuments.mockReturnValue(new Promise(() => {}));
			else getClaims.mockReturnValue(new Promise(() => {}));
			const retry = screen.getByRole('button', { name: 'Retry' });
			retry.focus();
			await fireEvent.click(retry);
			await settle();
			await fireEvent.click(retry);

			expect(screen.getByText(message)).toBeInTheDocument();
			expect(retry).toHaveAttribute('aria-disabled', 'true');
			expect(document.activeElement).toBe(retry);
			expect(failing).toHaveBeenCalledTimes(2);
		}
	);

	test('saving a claim keeps the claims section and the count on screen while it reloads', async () => {
		getClaims.mockResolvedValue([makeClaim()]);
		mount();
		await settle();
		let finish: (claims: InsuranceClaim[]) => void = () => {};
		getClaims.mockReturnValue(new Promise(resolve => (finish = resolve)));
		await fireEvent.click(screen.getByRole('button', { name: 'Edit claim' }));
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await settle();

		expect(screen.getByRole('heading', { name: 'Claims' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent('0 documents · 1 claim');

		finish([makeClaim(), makeClaim({ id: 'c2' })]);
		await settle();
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent('0 documents · 2 claims');
	});

	test('a failed claims load is shown in place of the claim count', async () => {
		getClaims.mockRejectedValue(new Error('offline'));
		mount();
		await settle();
		expect(screen.getByTestId('policy-attachments')).toHaveTextContent(/^0 documents$/);
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	test('read-only hides settings, term actions and documents but keeps claims', async () => {
		mount({ readOnly: true });
		await settle();
		expect(screen.queryByTitle('Policy settings')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Term actions' })).toBeNull();
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
		await chooseTermAction('Edit term');
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
		await chooseTermAction('Delete term');
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
		await chooseTermAction('Delete term', -1);
		await confirmDelete();
		expect(deleteTerm).toHaveBeenCalledWith('p1', 't-past');
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	test('a failed term delete notifies and skips the refresh', async () => {
		const failure = new Error('in use');
		deleteTerm.mockRejectedValue(failure);
		const { onRefresh } = mount();
		await settle();
		await chooseTermAction('Delete term');
		await confirmDelete();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, "Couldn't delete the term");
		expect(onRefresh).not.toHaveBeenCalled();
	});
});
