import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type {
	CreateClaimRequest,
	InsuranceClaim,
	PaginatedResponse,
	Photo,
	UpdateClaimRequest,
	Vehicle
} from '#lib/types/index.ts';
import { VEHICLES, makeClaim as claim, photoPage, settle } from './insurance-fixtures.ts';

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
vi.mock('#lib/utils/error-handling.ts', () => ({
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context),
	logLoadFailure: vi.fn(),
	userFacingErrorMessage: () => 'Something went wrong.'
}));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(() => Promise.resolve([])) }
}));

const ClaimsSection = (await import('../ClaimsSection.svelte')).default;

function claimDateTrigger(): HTMLElement {
	const field = document.querySelector('label[for="claim-date-p1"]')?.parentElement;
	return field?.querySelector('button') as HTMLElement;
}

async function pickClaimDate(dateValue: string): Promise<void> {
	await fireEvent.click(claimDateTrigger());
	const day = await vi.waitFor(() => {
		const el = document.querySelector(`[data-bits-day][data-value="${dateValue}"]`);
		if (!(el instanceof HTMLElement)) throw new Error(`no day ${dateValue}`);
		return el;
	});
	await fireEvent.click(day);
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

describe('ClaimsSection zero payout', () => {
	test('a $0 payout on a new claim is sent as 0', async () => {
		createClaim.mockResolvedValue(claim());
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: /file claim/i }));
		await pickClaimDate('2026-03-10');
		await fireEvent.input(document.getElementById('claim-payout-p1') as HTMLInputElement, {
			target: { value: '0' }
		});
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(createClaim.mock.calls[0]?.[1]).toMatchObject({ payoutAmount: 0 });
	});

	test('editing a payout down to $0 sends 0, not null', async () => {
		getClaims.mockResolvedValue([
			claim({ claimDate: localNoonISO(2026, 2, 15), payoutAmount: 300 })
		]);
		updateClaim.mockResolvedValue(claim());
		mount({ vehicles: VEHICLES });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit claim' }));
		await fireEvent.input(document.getElementById('claim-payout-p1') as HTMLInputElement, {
			target: { value: '0' }
		});
		await fireEvent.submit(document.querySelector('form') as HTMLFormElement);
		await settle();
		expect(updateClaim.mock.calls[0]?.[2]).toMatchObject({ payoutAmount: 0 });
	});
});
