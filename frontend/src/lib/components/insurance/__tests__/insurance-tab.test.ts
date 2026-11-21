import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type {
	InsuranceClaim,
	InsurancePolicy,
	PaginatedResponse,
	Photo
} from '#lib/types/index.ts';
import { makePolicy, makeTerm, photoPage, settle } from './insurance-fixtures.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const goto = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));

const getPoliciesForVehicle = vi.fn<(vehicleId: string) => Promise<InsurancePolicy[]>>();
const deleteTerm = vi.fn<(policyId: string, termId: string) => Promise<InsurancePolicy>>();
const getClaims = vi.fn<(policyId: string) => Promise<InsuranceClaim[]>>();
const getEntityDocuments =
	vi.fn<(entityType: string, entityId: string) => Promise<PaginatedResponse<Photo>>>();

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getPoliciesForVehicle: (vehicleId: string) => getPoliciesForVehicle(vehicleId),
		deleteTerm: (policyId: string, termId: string) => deleteTerm(policyId, termId),
		getClaims: (policyId: string) => getClaims(policyId),
		getEntityDocuments: (entityType: string, entityId: string) =>
			getEntityDocuments(entityType, entityId),
		getEntityDocumentThumbnailUrl: () => '/thumb',
		uploadEntityDocument: vi.fn(),
		deleteEntityDocument: vi.fn()
	}
}));

const handleErrorWithNotification = vi.fn<(error: unknown, context?: string) => void>();
vi.mock('#lib/utils/error-handling.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/error-handling.ts')>()),
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context)
}));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(() => Promise.resolve([])) }
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
	getEntityDocuments.mockResolvedValue(photoPage([]));
});

afterEach(() => {
	cleanup();
});

describe('InsuranceTab load states', () => {
	test('shows a spinner while policies load', async () => {
		getPoliciesForVehicle.mockReturnValue(new Promise(() => {}));
		const { container } = mount();
		await settle();
		expect(getPoliciesForVehicle).toHaveBeenCalledWith('v1');
		expect(container.querySelector('.animate-spin')).not.toBeNull();
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
		expect(handleErrorWithNotification).toHaveBeenCalledWith(
			failure,
			"Couldn't load insurance policies"
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
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
		await fireEvent.click(screen.getByRole('button', { name: /add policy/i }));
		expect(goto).toHaveBeenCalledWith(`/insurance/new?vehicleId=v1&returnTo=${RETURN_TO}`);
	});

	test('read-only viewers get a neutral message and no add button', async () => {
		mount(true);
		await settle();
		expect(screen.getByText('This vehicle has no insurance policies.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /add policy/i })).toBeNull();
	});
});

describe('InsuranceTab policy list', () => {
	const policy = makePolicy({
		terms: [makeTerm({ id: 't1', endDate: '2030-01-01' })]
	});

	test('lists the policies with a header add button', async () => {
		getPoliciesForVehicle.mockResolvedValue([policy]);
		mount();
		await settle();
		expect(screen.getByRole('heading', { name: 'Insurance Policies' })).toBeInTheDocument();
		expect(screen.getByText('Active Policies')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /add policy/i }));
		expect(goto).toHaveBeenCalledWith(`/insurance/new?vehicleId=v1&returnTo=${RETURN_TO}`);
	});

	test('editing a policy navigates to its edit page with a return path', async () => {
		getPoliciesForVehicle.mockResolvedValue([policy]);
		mount();
		await settle();
		await fireEvent.click(screen.getByTitle('Policy settings'));
		expect(goto).toHaveBeenCalledWith(`/insurance/p1/edit?returnTo=${RETURN_TO}`);
	});

	test('read-only lists policies without add or settings controls', async () => {
		getPoliciesForVehicle.mockResolvedValue([policy]);
		mount(true);
		await settle();
		expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /add policy/i })).toBeNull();
		expect(screen.queryByTitle('Policy settings')).toBeNull();
	});

	test('deleting a term reloads the policies through onRefresh', async () => {
		getPoliciesForVehicle.mockResolvedValue([policy]);
		deleteTerm.mockResolvedValue(policy);
		mount();
		await settle();
		await fireEvent.click(screen.getByTitle('Delete term'));
		await settle();
		await fireEvent.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		);
		await settle();
		expect(deleteTerm).toHaveBeenCalledWith('p1', 't1');
		expect(getPoliciesForVehicle).toHaveBeenCalledTimes(2);
	});
});
