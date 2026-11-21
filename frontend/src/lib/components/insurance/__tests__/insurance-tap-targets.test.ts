import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { makePolicy, makeTerm, photoPage, settle } from './insurance-fixtures.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getPoliciesForVehicle: () => Promise.resolve([makePolicy({ terms: [makeTerm()] })]),
		getClaims: () => Promise.resolve([]),
		getEntityDocuments: () => Promise.resolve(photoPage([])),
		getEntityDocumentThumbnailUrl: () => '/thumb',
		deleteTerm: vi.fn(),
		uploadEntityDocument: vi.fn(),
		deleteEntityDocument: vi.fn()
	}
}));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: () => Promise.resolve([]) }
}));

const PolicyTermCard = (await import('../PolicyTermCard.svelte')).default;
const PolicyCard = (await import('../PolicyCard.svelte')).default;
const InsuranceTab = (await import('../InsuranceTab.svelte')).default;

afterEach(() => {
	cleanup();
});

function expectTouchSized(button: HTMLElement): void {
	expect(button.className).toContain('size-10');
	expect(button.className).not.toMatch(/\b[hw]-7\b/);
}

describe('insurance action buttons', () => {
	test('term edit and delete are labelled 40px icon buttons and Renew is not text-xs', () => {
		render(PolicyTermCard, {
			props: {
				term: makeTerm(),
				isCurrent: true,
				onEdit: vi.fn(),
				onDelete: vi.fn(),
				onRenew: vi.fn()
			}
		});

		for (const name of ['Edit term', 'Delete term']) {
			const button = screen.getByRole('button', { name });
			expect(button).toHaveAttribute('aria-label', name);
			expectTouchSized(button);
		}

		const renew = screen.getByRole('button', { name: 'Renew' });
		expect(renew.className).not.toContain('text-xs');
		expect(renew.className).toContain('h-10');
	});

	test('policy settings is a labelled 40px icon button', () => {
		render(PolicyCard, {
			props: { policy: makePolicy({ terms: [makeTerm()] }), onEdit: vi.fn(), onRefresh: vi.fn() }
		});

		const settings = screen.getByRole('button', { name: 'Policy settings' });
		expect(settings).toHaveAttribute('aria-label', 'Policy settings');
		expectTouchSized(settings);
	});

	test('Add Policy on the vehicle page is 40px tall on mobile', async () => {
		render(InsuranceTab, { props: { vehicleId: 'v1' } });
		await settle();

		expect(screen.getByRole('button', { name: 'Add Policy' }).className).toContain('h-10');
	});
});
