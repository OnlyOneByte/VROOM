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
	test('the term actions menu is a labelled 40px icon button', () => {
		render(PolicyTermCard, {
			props: {
				term: makeTerm(),
				isCurrent: true,
				onEdit: vi.fn(),
				onDelete: vi.fn()
			}
		});

		const menu = screen.getByRole('button', { name: 'Term actions' });
		expect(menu).toHaveAttribute('aria-label', 'Term actions');
		expectTouchSized(menu);
	});

	test('the policy footer actions are 40px tall on touch and not text-xs', async () => {
		render(PolicyCard, {
			props: { policy: makePolicy({ terms: [makeTerm()] }), onEdit: vi.fn(), onRefresh: vi.fn() }
		});
		await settle();

		for (const name of ['Upload', 'File Claim', 'Renew']) {
			const button = screen.getByRole('button', { name });
			expect(button.className).toContain('h-10');
			expect(button.className).not.toContain('text-xs');
		}
	});

	test('policy settings is a labelled 40px icon button', () => {
		render(PolicyCard, {
			props: { policy: makePolicy({ terms: [makeTerm()] }), onEdit: vi.fn(), onRefresh: vi.fn() }
		});

		const settings = screen.getByRole('button', { name: 'Policy settings' });
		expect(settings).toHaveAttribute('aria-label', 'Policy settings');
		expectTouchSized(settings);
	});

	test('Add policy on the vehicle page is 40px tall on mobile', async () => {
		render(InsuranceTab, { props: { vehicleId: 'v1' } });
		await settle();

		expect(screen.getByRole('button', { name: 'Add policy' }).className).toContain('h-10');
	});
});
