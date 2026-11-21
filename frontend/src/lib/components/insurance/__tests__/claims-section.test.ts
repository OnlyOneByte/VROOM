import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type {
	CreateClaimRequest,
	InsuranceClaim,
	PaginatedResponse,
	Photo,
	UpdateClaimRequest,
	Vehicle
} from '#lib/types/index.ts';
import { VEHICLES, makeClaim as claim, photoPage, settle } from './insurance-fixtures.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const getClaims = vi.fn<(policyId: string) => Promise<InsuranceClaim[]>>();
const createClaim =
	vi.fn<(policyId: string, data: CreateClaimRequest) => Promise<InsuranceClaim>>();
const updateClaim =
	vi.fn<(policyId: string, claimId: string, data: UpdateClaimRequest) => Promise<InsuranceClaim>>();
const deleteClaim = vi.fn<(policyId: string, claimId: string) => Promise<void>>();
const getEntityDocuments =
	vi.fn<(entityType: string, entityId: string) => Promise<PaginatedResponse<Photo>>>();

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getClaims: (policyId: string) => getClaims(policyId),
		createClaim: (policyId: string, data: CreateClaimRequest) => createClaim(policyId, data),
		updateClaim: (policyId: string, claimId: string, data: UpdateClaimRequest) =>
			updateClaim(policyId, claimId, data),
		deleteClaim: (policyId: string, claimId: string) => deleteClaim(policyId, claimId),
		getEntityDocuments: (entityType: string, entityId: string) =>
			getEntityDocuments(entityType, entityId),
		getEntityDocumentThumbnailUrl: (entityType: string, entityId: string, id: string) =>
			`/thumb/${entityType}/${entityId}/${id}`,
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

const showError = vi.fn((_message: string) => {});
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: (message: string) => showError(message), addNotification: vi.fn() }
}));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(() => Promise.resolve([])) }
}));

const ClaimsSection = (await import('../ClaimsSection.svelte')).default;

async function pickOption(triggerId: string, optionName: string): Promise<void> {
	await fireEvent.click(document.getElementById(triggerId) as HTMLElement);
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name: optionName }));
	await settle();
}

function claimDateTrigger(): HTMLElement {
	const field = document.querySelector('label[for="claim-date"]')?.parentElement;
	return field?.querySelector('button') as HTMLElement;
}

async function pickClaimDate(dateValue: string): Promise<void> {
	await fireEvent.click(claimDateTrigger());
	await settle();
	await fireEvent.click(
		document.querySelector(`[data-bits-day][data-value="${dateValue}"]`) as HTMLElement
	);
	await settle();
}

function localNoonISO(year: number, monthIndex: number, day: number): string {
	return new Date(year, monthIndex, day, 12, 0, 0).toISOString();
}

function mount(props: { vehicles?: Vehicle[]; readOnly?: boolean } = {}) {
	return render(ClaimsSection, { props: { policyId: 'p1', ...props } });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 2, 20, 10, 0, 0));
	vi.clearAllMocks();
	getClaims.mockResolvedValue([]);
	getEntityDocuments.mockResolvedValue(photoPage([]));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('ClaimsSection load states', () => {
	test('shows a spinner and no list while claims are still loading', async () => {
		getClaims.mockReturnValue(new Promise(() => {}));
		const { container } = mount();
		await settle();
		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByText('No claims filed.')).toBeNull();
		expect(getClaims).toHaveBeenCalledWith('p1');
	});

	test('shows the empty state when the policy has no claims', async () => {
		mount();
		await settle();
		expect(screen.getByText('No claims filed.')).toBeInTheDocument();
	});

	test('shows the error message and notifies when loading fails', async () => {
		const failure = new ApiError('Network down', 503);
		getClaims.mockRejectedValueOnce(failure);
		mount();
		await settle();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText('Network down')).toBeNull();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, "Couldn't load claims");
	});

	test('falls back to a generic message when the rejection is not an Error', async () => {
		getClaims.mockRejectedValueOnce('boom');
		mount();
		await settle();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeInTheDocument();
	});

	test('retry after a failed load refetches and renders the claims', async () => {
		getClaims.mockRejectedValueOnce(new Error('Network down'));
		getClaims.mockResolvedValueOnce([claim()]);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(getClaims).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('Network down')).toBeNull();
		expect(screen.getByText('Collision')).toBeInTheDocument();
	});
});

describe('ClaimsSection claim rows', () => {
	test('renders type, status, fault, formatted date, payout, vehicle and description', async () => {
		getClaims.mockResolvedValue([
			claim({
				claimType: 'weather',
				status: 'in_progress',
				faultDesignation: 'not_at_fault',
				payoutAmount: 1250.5,
				vehicleId: 'v1',
				description: 'Hail damage on the roof'
			})
		]);
		mount({ vehicles: VEHICLES });
		await settle();
		expect(screen.getByText('Weather')).toBeInTheDocument();
		expect(screen.getByText('In progress')).toBeInTheDocument();
		expect(screen.getByText('Not at fault')).toBeInTheDocument();
		expect(screen.getByText('Mar 15, 2026')).toBeInTheDocument();
		expect(screen.getByText('Payout: $1,250.50')).toBeInTheDocument();
		expect(screen.getByText('Daily')).toBeInTheDocument();
		expect(screen.getByText('Hail damage on the roof')).toBeInTheDocument();
	});

	test('omits payout, fault and unknown vehicles when absent', async () => {
		getClaims.mockResolvedValue([
			claim({ status: 'denied', payoutAmount: null, faultDesignation: null, vehicleId: 'gone' })
		]);
		mount({ vehicles: VEHICLES });
		await settle();
		expect(screen.getByText('Denied')).toBeInTheDocument();
		expect(screen.queryByText(/Payout:/)).toBeNull();
		expect(screen.queryByText(/fault/i)).toBeNull();
		expect(screen.queryByText('gone')).toBeNull();
	});

	test('renders a zero payout instead of hiding it', async () => {
		getClaims.mockResolvedValue([claim({ status: 'settled', payoutAmount: 0 })]);
		mount();
		await settle();
		expect(screen.getByText('Settled')).toBeInTheDocument();
		expect(screen.getByText('Payout: $0.00')).toBeInTheDocument();
	});

	test('read-only mode hides filing, editing, deleting and documents controls', async () => {
		getClaims.mockResolvedValue([claim()]);
		mount({ readOnly: true });
		await settle();
		expect(screen.getByText('Collision')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /file claim/i })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Edit claim' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete claim' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Claim documents' })).toBeNull();
	});

	test('the documents toggle mounts and unmounts the claim document viewer', async () => {
		getClaims.mockResolvedValue([claim()]);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Claim documents' }));
		await settle();
		expect(getEntityDocuments).toHaveBeenCalledWith('insurance_claim', 'c1');
		expect(screen.getByText('Documents')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Claim documents' }));
		await settle();
		expect(screen.queryByText('Documents')).toBeNull();
	});
});

describe('ClaimsSection filing a claim', () => {
	test('submitting without a date reports the validation error and does not call the API', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		expect(screen.getByText('File a claim')).toBeInTheDocument();
		expect(screen.queryByText('No claims filed.')).toBeNull();
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(showError).toHaveBeenCalledWith('Enter a claim date.');
		expect(handleErrorWithNotification).not.toHaveBeenCalled();
		expect(createClaim).not.toHaveBeenCalled();
	});

	test('hides the vehicle picker when no vehicles are provided', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		expect(document.getElementById('claim-vehicle')).toBeNull();
		expect(document.getElementById('claim-fault')).toHaveTextContent('Not specified');
	});

	test('files a fully populated claim, refetches and closes the form', async () => {
		createClaim.mockResolvedValue(claim({ id: 'new' }));
		mount({ vehicles: VEHICLES });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await pickClaimDate('2026-03-15');
		await pickOption('claim-type', 'Theft');
		await pickOption('claim-status', 'Settled');
		await pickOption('claim-fault', 'Shared fault');
		await pickOption('claim-vehicle', '2019 Honda Civic');
		expect(document.getElementById('claim-type')).toHaveTextContent('Theft');
		expect(document.getElementById('claim-status')).toHaveTextContent('Settled');
		expect(document.getElementById('claim-fault')).toHaveTextContent('Shared fault');
		expect(document.getElementById('claim-vehicle')).toHaveTextContent('2019 Honda Civic');
		await fireEvent.input(document.getElementById('claim-payout') as HTMLInputElement, {
			target: { value: '500.25' }
		});
		await fireEvent.input(document.getElementById('claim-desc') as HTMLTextAreaElement, {
			target: { value: '  Stolen overnight  ' }
		});
		const submitButton = screen.getAllByRole('button', { name: /file claim/i }).at(-1);
		expect(submitButton).toHaveAttribute('type', 'submit');
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(createClaim).toHaveBeenCalledWith('p1', {
			claimDate: localNoonISO(2026, 2, 15),
			claimType: 'theft',
			status: 'settled',
			description: 'Stolen overnight',
			payoutAmount: 500.25,
			faultDesignation: 'shared',
			vehicleId: 'v2'
		});
		expect(getClaims).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('File a claim')).toBeNull();
	});

	test('files a minimal claim with optional fields left undefined', async () => {
		createClaim.mockResolvedValue(claim());
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await pickClaimDate('2026-03-10');
		await fireEvent.input(document.getElementById('claim-desc') as HTMLTextAreaElement, {
			target: { value: '   ' }
		});
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(createClaim).toHaveBeenCalledWith('p1', {
			claimDate: localNoonISO(2026, 2, 10),
			claimType: 'collision',
			status: 'filed',
			description: undefined,
			payoutAmount: undefined,
			faultDesignation: undefined,
			vehicleId: undefined
		});
	});

	test('disables the form buttons while a claim is being saved', async () => {
		createClaim.mockReturnValue(new Promise(() => {}));
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await pickClaimDate('2026-03-10');
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		const submitButton = screen.getAllByRole('button', { name: /file claim/i }).at(-1);
		expect(submitButton).toBeDisabled();
		expect(submitButton?.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.getAllByRole('button', { name: 'Cancel' })[1]).toBeDisabled();
	});

	test('a failed create notifies and keeps the form open', async () => {
		const failure = new Error('500');
		createClaim.mockRejectedValue(failure);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await pickClaimDate('2026-03-10');
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, "Couldn't file the claim");
		expect(screen.getByText('File a claim')).toBeInTheDocument();
		expect(getClaims).toHaveBeenCalledTimes(1);
	});

	test('both the close icon and the Cancel button dismiss the form', async () => {
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
		expect(screen.queryByText('File a claim')).toBeNull();
		expect(screen.getByText('No claims filed.')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[1]!);
		expect(screen.queryByText('File a claim')).toBeNull();
	});
});

describe('ClaimsSection editing a claim', () => {
	test('pre-fills the form from the claim and sends nulls for cleared optionals', async () => {
		getClaims.mockResolvedValue([
			claim({
				status: 'in_progress',
				claimType: 'vandalism',
				faultDesignation: 'at_fault',
				payoutAmount: 300,
				vehicleId: 'v1',
				description: 'Keyed door'
			})
		]);
		updateClaim.mockResolvedValue(claim());
		mount({ vehicles: VEHICLES });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit claim' }));
		expect(screen.getByText('Edit claim')).toBeInTheDocument();
		expect(document.getElementById('claim-type')).toHaveTextContent('Vandalism');
		expect(document.getElementById('claim-status')).toHaveTextContent('In progress');
		expect(document.getElementById('claim-fault')).toHaveTextContent('At fault');
		expect(document.getElementById('claim-vehicle')).toHaveTextContent('Daily');
		expect(document.getElementById('claim-payout')).toHaveValue(300);
		expect(document.getElementById('claim-desc')).toHaveValue('Keyed door');
		expect(claimDateTrigger()).toHaveTextContent('March 15, 2026');
		await fireEvent.input(document.getElementById('claim-payout') as HTMLInputElement, {
			target: { value: '' }
		});
		await fireEvent.input(document.getElementById('claim-desc') as HTMLTextAreaElement, {
			target: { value: '' }
		});
		expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(updateClaim).toHaveBeenCalledWith('p1', 'c1', {
			claimDate: localNoonISO(2026, 2, 15),
			claimType: 'vandalism',
			status: 'in_progress',
			description: null,
			payoutAmount: null,
			faultDesignation: 'at_fault',
			vehicleId: 'v1'
		});
		expect(screen.queryByText('Edit claim')).toBeNull();
	});

	test('editing a claim without optionals sends null for each one', async () => {
		getClaims.mockResolvedValue([claim()]);
		updateClaim.mockResolvedValue(claim());
		mount({ vehicles: VEHICLES });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit claim' }));
		expect(document.getElementById('claim-vehicle')).toHaveTextContent('Not specified');
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(updateClaim).toHaveBeenCalledWith(
			'p1',
			'c1',
			expect.objectContaining({
				description: null,
				payoutAmount: null,
				faultDesignation: null,
				vehicleId: null
			})
		);
	});

	test('a failed update notifies with the update context', async () => {
		const failure = new Error('409');
		getClaims.mockResolvedValue([claim()]);
		updateClaim.mockRejectedValue(failure);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit claim' }));
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, "Couldn't update the claim");
		expect(screen.getByText('Edit claim')).toBeInTheDocument();
	});

	test('opening a new claim after editing resets the form', async () => {
		getClaims.mockResolvedValue([claim({ claimType: 'theft', description: 'x' })]);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit claim' }));
		await fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		expect(screen.getByText('File a claim')).toBeInTheDocument();
		expect(document.getElementById('claim-type')).toHaveTextContent('Collision');
		expect(document.getElementById('claim-desc')).toHaveValue('');
	});
});

describe('ClaimsSection deleting a claim', () => {
	test('confirming the dialog deletes the claim and removes the row', async () => {
		getClaims.mockResolvedValue([claim(), claim({ id: 'c2', claimType: 'theft' })]);
		deleteClaim.mockResolvedValue();
		mount();
		await settle();
		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete claim' })[0]!);
		await settle();
		const dialog = screen.getByRole('alertdialog');
		expect(within(dialog).getByText('Delete claim?')).toBeInTheDocument();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();
		expect(deleteClaim).toHaveBeenCalledWith('p1', 'c1');
		expect(screen.queryByText('Collision')).toBeNull();
		expect(screen.getByText('Theft')).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('a failed delete notifies, keeps the row and leaves the dialog open', async () => {
		const failure = new Error('locked');
		getClaims.mockResolvedValue([claim()]);
		deleteClaim.mockRejectedValue(failure);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete claim' }));
		await settle();
		await fireEvent.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		);
		await settle();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(failure, "Couldn't delete the claim");
		expect(screen.getByText('Collision')).toBeInTheDocument();
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});
});
