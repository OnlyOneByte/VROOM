import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import type { ReceivedShare } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { listReceived, decline } = vi.hoisted(() => ({
	listReceived: vi.fn<() => Promise<ReceivedShare[]>>(),
	decline: vi.fn<(id: string) => Promise<void>>()
}));
vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
		listReceived: () => listReceived(),
		accept: () => Promise.resolve(),
		decline: (id: string) => decline(id)
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([
				{ id: 'v1', year: 2020, make: 'Toyota', model: 'Camry', vehicleType: 'gas' }
			])
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 50,
				expenseCount: 3,
				recentAmount: 50,
				monthlyAverage: 50,
				categoryBreakdown: [],
				monthlyTrend: []
			}),
		getAllExpenses: () =>
			Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 4, offset: 0 } })
	}
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () => Promise.resolve([]),
		getRecurringCost: () => Promise.resolve({ count: 0, monthlyTotal: 0 })
	}
}));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getAllPolicies: () => Promise.resolve([]) }
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { query: () => Promise.resolve(null) }
}));

import Page from '../+page.svelte';

const INVITE: ReceivedShare = {
	id: 's1',
	vehicleId: 'v9',
	ownerId: 'other',
	sharedWithId: 'me',
	level: 'viewer',
	status: 'pending',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	vehicleName: 'Camp Wagon',
	sharedBy: 'Sam'
};

beforeEach(() => {
	listReceived.mockReset();
	decline.mockReset().mockResolvedValue();
	vi.mocked(window.matchMedia).mockReturnValue({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MediaQueryList);
});

describe('dashboard invitations', () => {
	test('declining the only invitation leaves no invitations block behind', async () => {
		listReceived.mockResolvedValue([INVITE]);
		render(Page);

		await fireEvent.click(
			await screen.findByRole('button', { name: 'Decline the invitation to Camp Wagon' })
		);

		await waitFor(() => expect(screen.queryByTestId('shared-with-you')).toBeNull());
		expect(screen.queryByText("Couldn't load your invitations")).toBeNull();
		expect(listReceived).toHaveBeenCalledTimes(1);
	});

	test.each([
		{ narrow: true, order: ['Shared with you', 'Your vehicles', 'Recent'] },
		{ narrow: false, order: ['Your vehicles', 'Shared with you', 'Recent'] }
	])('sections are read in screen order (narrow: $narrow)', async ({ narrow, order }) => {
		vi.mocked(window.matchMedia).mockReturnValue({
			matches: narrow,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as MediaQueryList);
		listReceived.mockResolvedValue([INVITE]);
		render(Page);

		await screen.findByText('Camp Wagon');
		const headings = screen
			.getAllByRole('heading', { level: 2 })
			.map(h => h.textContent?.trim())
			.filter(text => order.includes(text ?? ''));
		expect(headings).toEqual(order);
	});

	test('a failed load says why, and Retry shows the invitation in its place', async () => {
		listReceived
			.mockRejectedValueOnce(new ApiError('SQLITE_BUSY', 500))
			.mockResolvedValueOnce([INVITE]);
		render(Page);

		expect(await screen.findByText("Couldn't load your invitations")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(await screen.findByText('Camp Wagon')).toBeInTheDocument();
		expect(screen.queryByText("Couldn't load your invitations")).toBeNull();
	});
});
