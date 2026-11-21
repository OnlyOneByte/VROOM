import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { InsuranceClaim } from '#lib/types/index.ts';
import { makeClaim, makeTerm, photoPage, settle } from './insurance-fixtures.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const getClaims = vi.fn<(policyId: string) => Promise<InsuranceClaim[]>>();
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getClaims: (policyId: string) => getClaims(policyId),
		getEntityDocuments: () => Promise.resolve(photoPage([])),
		getEntityDocumentThumbnailUrl: () => '/thumb',
		uploadEntityDocument: vi.fn(),
		deleteEntityDocument: vi.fn()
	}
}));
vi.mock('#lib/utils/error-handling.ts', () => ({ handleErrorWithNotification: vi.fn() }));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(() => Promise.resolve([])) }
}));

const ClaimsSection = (await import('../ClaimsSection.svelte')).default;
const PolicyTermCard = (await import('../PolicyTermCard.svelte')).default;
const DocumentViewer = (await import('../DocumentViewer.svelte')).default;

function classes(element: HTMLElement): string[] {
	return element.className.split(/\s+/);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 10, 21, 10, 0, 0));
	getClaims.mockResolvedValue([makeClaim()]);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('claim action buttons', () => {
	test('claim icon buttons are 40px on touch and File Claim is not text-xs', async () => {
		render(ClaimsSection, { props: { policyId: 'p1' } });
		await settle();

		for (const name of ['Claim documents', 'Edit claim', 'Delete claim']) {
			const button = screen.getByRole('button', { name });
			expect(classes(button)).toContain('size-10');
			expect(classes(button)).not.toContain('h-7');
		}

		const fileClaim = screen.getByRole('button', { name: 'File Claim' });
		expect(classes(fileClaim)).toContain('h-10');
		expect(classes(fileClaim)).not.toContain('text-xs');
	});

	test('the documents toggle reports whether it is expanded', async () => {
		render(ClaimsSection, { props: { policyId: 'p1' } });
		await settle();

		expect(screen.getByRole('button', { name: 'Claim documents' })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
	});
});

describe('document upload button', () => {
	test('Upload is 40px tall on touch and not text-xs', async () => {
		render(DocumentViewer, { props: { entityType: 'insurance_policy', entityId: 'p1' } });
		await settle();

		const upload = screen.getByRole('button', { name: 'Upload' });
		expect(classes(upload)).toContain('h-10');
		expect(classes(upload)).not.toContain('text-xs');
	});
});

describe('latest term label', () => {
	test('an ended latest term is not called the current term', () => {
		render(PolicyTermCard, {
			props: { term: makeTerm({ startDate: '2023-07-01', endDate: '2024-06-30' }), isCurrent: true }
		});

		expect(screen.queryByText('Current Term')).toBeNull();
		expect(screen.getByText('Latest Term')).toBeInTheDocument();
		expect(screen.getByText('Ended')).toBeInTheDocument();
		expect(screen.queryByText('Expires')).toBeNull();
	});

	test('a latest term that has not ended stays the current term', () => {
		render(PolicyTermCard, {
			props: { term: makeTerm({ startDate: '2026-06-01', endDate: '2027-06-01' }), isCurrent: true }
		});

		expect(screen.getByText('Current Term')).toBeInTheDocument();
		expect(screen.getByText('Expires')).toBeInTheDocument();
	});
});
