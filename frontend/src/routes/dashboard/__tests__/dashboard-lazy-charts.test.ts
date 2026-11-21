import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let pieRendered = false;
vi.mock('#lib/components/charts/index.ts', () => ({
	AppPieChart: () => {
		pieRendered = true;
	}
}));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/VehicleCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/SharedWithMeCard.svelte', () => ({ default: () => {} }));

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle]),
		getAllVehiclePhotos: () => Promise.resolve({}),
		getPhotoThumbnailUrl: () => ''
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getVehicleStats: () => Promise.resolve([]),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 0,
				expenseCount: 0,
				recentAmount: 0,
				monthlyAverage: 0,
				categoryBreakdown: [],
				monthlyTrend: []
			}),
		getAllExpenses: () =>
			Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 5, offset: 0 } })
	}
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () => Promise.resolve([]),
		getRecurringCost: () => Promise.resolve({ count: 0, monthlyTotal: 0 })
	}
}));

import Page from '../+page.svelte';

describe('dashboard chart row', () => {
	test('chart components are not imported statically, so layerchart stays out of the route chunk', () => {
		expect(SRC).not.toMatch(/^\s*import\s[^;]*['"]#lib\/components\/charts\/index\.ts['"]/m);
		expect(SRC).not.toMatch(
			/^\s*import\s[^;]*['"]#lib\/components\/charts\/ExpenseTrendChart\.svelte['"]/m
		);
		expect(SRC).toMatch(/import\('#lib\/components\/charts\/ExpenseTrendChart\.svelte'\)/);
		expect(SRC).toMatch(/import\('#lib\/components\/charts\/index\.ts'\)/);
	});

	test('the lazily loaded charts render once their module arrives', async () => {
		render(Page);

		await waitFor(() => expect(pieRendered).toBe(true));
		expect(screen.queryByText('Charts could not be loaded', { exact: false })).toBeNull();
	});
});
