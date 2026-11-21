import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { InsuranceTerm, TermCoverageRow } from '#lib/types/index.ts';
import { VEHICLES, makeTerm } from './insurance-fixtures.ts';

const goto = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));

const TermHistory = (await import('../TermHistory.svelte')).default;

function term(id: string, startDate: string, endDate: string): InsuranceTerm {
	return makeTerm({ id, startDate, endDate });
}

const OLDER = term('t-old', '2023-01-01', '2024-01-01');
const NEWER = term('t-new', '2024-01-01', '2025-01-01');

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('TermHistory', () => {
	test('shows a placeholder when there are no past terms', () => {
		render(TermHistory, { props: { terms: [], policyId: 'p1' } });
		expect(screen.getByText('Past Terms')).toBeInTheDocument();
		expect(screen.getByText('No past terms.')).toBeInTheDocument();
	});

	test('lists terms newest end date first', () => {
		render(TermHistory, { props: { terms: [OLDER, NEWER], policyId: 'p1' } });
		const ends = screen.getAllByText('End').map(label => label.nextElementSibling?.textContent);
		expect(ends).toEqual(['Jan 1, 2025', 'Jan 1, 2024']);
		expect(screen.getAllByText('Past Term')).toHaveLength(2);
	});

	test('names covered vehicles, falling back to the id when the vehicle is unknown', () => {
		const coverage: TermCoverageRow[] = [
			{ termId: 't-new', vehicleId: 'v1' },
			{ termId: 't-new', vehicleId: 'v2' },
			{ termId: 't-old', vehicleId: 'v-sold' }
		];
		render(TermHistory, {
			props: {
				terms: [OLDER, NEWER],
				policyId: 'p1',
				vehicles: VEHICLES,
				termVehicleCoverage: coverage
			}
		});
		expect(screen.getByText('Daily, 2019 Honda Civic')).toBeInTheDocument();
		expect(screen.getByText('v-sold')).toBeInTheDocument();
	});

	test('shows no vehicle row when no vehicles are known', () => {
		render(TermHistory, {
			props: {
				terms: [NEWER],
				policyId: 'p1',
				termVehicleCoverage: [{ termId: 't-new', vehicleId: 'v1' }]
			}
		});
		expect(screen.queryByText('Vehicles')).toBeNull();
	});

	test('edit navigates to the term edit route for this policy', async () => {
		render(TermHistory, { props: { terms: [NEWER], policyId: 'p1' } });
		await fireEvent.click(screen.getByTitle('Edit term'));
		expect(goto).toHaveBeenCalledWith('/insurance/p1/terms/t-new/edit');
	});

	test('delete is offered only when a delete handler is provided', () => {
		const onDeleteTerm = vi.fn<(t: InsuranceTerm) => void>();
		const { unmount } = render(TermHistory, { props: { terms: [NEWER], policyId: 'p1' } });
		expect(screen.queryByTitle('Delete term')).toBeNull();
		unmount();
		render(TermHistory, { props: { terms: [NEWER], policyId: 'p1', onDeleteTerm } });
		expect(screen.getByTitle('Delete term')).toBeInTheDocument();
	});

	test('read-only mode hides edit and delete', () => {
		render(TermHistory, {
			props: { terms: [NEWER], policyId: 'p1', readOnly: true, onDeleteTerm: vi.fn() }
		});
		expect(screen.queryByTitle('Edit term')).toBeNull();
		expect(screen.queryByTitle('Delete term')).toBeNull();
	});
});
