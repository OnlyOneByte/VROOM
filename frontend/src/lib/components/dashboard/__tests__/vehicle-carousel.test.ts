import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '')
}));

import VehicleCarousel from '../VehicleCarousel.svelte';

interface Overview {
	id: string;
	name: string;
	nickname?: string | null;
	recentExpenses: number;
	totalExpenses: number;
	lastActivity: Date | null;
	hasActiveFinancing: boolean;
	coverPhotoUrl?: string | null;
	sharedBy?: string | null;
}

const NOW = new Date('2026-11-21T12:00:00Z');

function overview(overrides: Partial<Overview> = {}): Overview {
	return {
		id: 'v1',
		name: '2020 Toyota Camry',
		nickname: null,
		recentExpenses: 120,
		totalExpenses: 4500,
		lastActivity: null,
		hasActiveFinancing: false,
		coverPhotoUrl: null,
		sharedBy: null,
		...overrides
	};
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	goto.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('VehicleCarousel states', () => {
	test('shows three skeletons and no vehicles while loading', () => {
		const { container } = render(VehicleCarousel, {
			vehicles: [overview()],
			isLoading: true
		});

		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
		expect(screen.queryByText('2020 Toyota Camry')).toBeNull();
	});

	test('an empty fleet shows the empty state with an Add Vehicle link', () => {
		render(VehicleCarousel, { vehicles: [] });

		expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add Vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
	});

	test('a single vehicle renders without previous/next navigation buttons', () => {
		render(VehicleCarousel, { vehicles: [overview()] });

		expect(screen.getByRole('link', { name: '2020 Toyota Camry' })).toHaveAttribute(
			'href',
			'/vehicles/v1'
		);
		expect(screen.queryByRole('button', { name: 'Previous slide' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Next slide' })).toBeNull();
	});

	test('more than one vehicle adds previous and next navigation buttons', async () => {
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});

		const previous = screen.getByRole('button', { name: 'Previous slide' });
		const next = screen.getByRole('button', { name: 'Next slide' });
		expect(previous).toBeInTheDocument();
		expect(next).toBeInTheDocument();

		await fireEvent.click(next);
		await fireEvent.click(previous);
		await fireEvent.keyDown(next, { key: 'ArrowLeft' });
		await fireEvent.keyDown(next, { key: 'ArrowRight' });

		expect(screen.getByRole('link', { name: '2019 Honda Civic' })).toBeInTheDocument();
	});
});

describe('VehicleCarousel vehicle card', () => {
	test('a nickname is the link text and the full name is shown beneath it', () => {
		render(VehicleCarousel, { vehicles: [overview({ nickname: 'Daily Driver' })] });

		expect(screen.getByRole('link', { name: 'Daily Driver' })).toBeInTheDocument();
		expect(screen.getByText('2020 Toyota Camry')).toBeInTheDocument();
	});

	test('shows recent and total expenses as currency', () => {
		render(VehicleCarousel, {
			vehicles: [overview({ recentExpenses: 120.5, totalExpenses: 4500 })]
		});

		expect(screen.getByText('$120.50')).toBeInTheDocument();
		expect(screen.getByText('$4,500.00')).toBeInTheDocument();
	});

	test('the card Add Expense button is 40px tall', () => {
		render(VehicleCarousel, { vehicles: [overview()] });

		expect(screen.getByRole('button', { name: 'Add Expense' })).toHaveClass('h-10');
	});

	test('a vehicle with no activity says so', () => {
		render(VehicleCarousel, { vehicles: [overview({ lastActivity: null })] });

		expect(screen.getByText('No activity')).toBeInTheDocument();
	});

	test('a vehicle with recent activity shows a relative time instead', () => {
		render(VehicleCarousel, {
			vehicles: [overview({ lastActivity: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000) })]
		});

		expect(screen.getByText('2 days ago')).toBeInTheDocument();
		expect(screen.queryByText('No activity')).toBeNull();
	});

	test('a cover photo is rendered as an image with the vehicle name as alt text', () => {
		render(VehicleCarousel, {
			vehicles: [overview({ coverPhotoUrl: '/photos/cover.jpg' })]
		});

		expect(screen.getByRole('img', { name: '2020 Toyota Camry' })).toHaveAttribute(
			'src',
			'/photos/cover.jpg'
		);
	});

	test('without a cover photo no image is rendered', () => {
		render(VehicleCarousel, { vehicles: [overview()] });

		expect(screen.queryByRole('img', { name: '2020 Toyota Camry' })).toBeNull();
	});

	test('financed and shared vehicles carry their badges', () => {
		render(VehicleCarousel, {
			vehicles: [overview({ hasActiveFinancing: true, sharedBy: 'pat@example.com' })]
		});

		expect(screen.getByText('Financed')).toBeInTheDocument();
		expect(screen.getByText(/Shared by pat@example.com/)).toBeInTheDocument();
	});

	test('an owned, unfinanced vehicle has neither badge', () => {
		render(VehicleCarousel, { vehicles: [overview()] });

		expect(screen.queryByText('Financed')).toBeNull();
		expect(screen.queryByText(/Shared by/)).toBeNull();
	});

	test('Add Expense navigates to the new-expense form preselecting the vehicle', async () => {
		render(VehicleCarousel, { vehicles: [overview({ id: 'v9' })] });

		await fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));

		expect(goto).toHaveBeenCalledWith('/expenses/new?vehicleId=v9&returnTo=%2Fdashboard');
	});
});
