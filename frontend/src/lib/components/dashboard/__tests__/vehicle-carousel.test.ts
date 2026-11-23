import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const goto = vi.fn((_url: string) => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '')
}));

const { embla } = vi.hoisted(() => {
	type Listener = () => void;
	const listeners = new Map<string, Listener[]>();
	const range = { index: 0, last: 1 };
	const emit = (event: string) => listeners.get(event)?.forEach(listener => listener());
	const api = {
		canScrollPrev: () => range.index > 0,
		canScrollNext: () => range.index < range.last,
		scrollPrev: () => {
			range.index = Math.max(0, range.index - 1);
			emit('select');
		},
		scrollNext: () => {
			range.index = Math.min(range.last, range.index + 1);
			emit('select');
		},
		scrollTo: () => {},
		scrollSnapList: () => Array.from({ length: range.last + 1 }, (_, i) => i),
		selectedScrollSnap: () => range.index,
		on: (event: string, listener: Listener) => {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
			return api;
		},
		off: () => api
	};
	return {
		embla: {
			api,
			reset(last: number) {
				listeners.clear();
				range.index = 0;
				range.last = last;
			},
			resize(last: number) {
				range.last = last;
				range.index = Math.min(range.index, last);
				emit('reInit');
			}
		}
	};
});

vi.mock('embla-carousel-svelte', () => ({
	default: (node: HTMLElement) => {
		queueMicrotask(() => node.dispatchEvent(new CustomEvent('emblaInit', { detail: embla.api })));
		return { update: () => {}, destroy: () => {} };
	}
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
	make?: string;
	vehicleType?: string;
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

	test('when every card fits there are no arrows, even with two vehicles', async () => {
		embla.reset(0);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});
		await vi.waitFor(() => expect(screen.getByText('2019 Honda Civic')).toBeInTheDocument());

		expect(screen.queryByRole('button', { name: 'Previous slide' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Next slide' })).toBeNull();
	});

	test('the arrow that cannot page is dimmed and keeps focus at the end of the fleet', async () => {
		embla.reset(1);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});
		const next = await screen.findByRole('button', { name: 'Next slide' });
		const previous = screen.getByRole('button', { name: 'Previous slide' });
		expect(previous).toHaveAttribute('aria-disabled', 'true');
		expect(next).toHaveAttribute('aria-disabled', 'false');

		next.focus();
		await fireEvent.click(next);

		expect(next).toHaveAttribute('aria-disabled', 'true');
		expect(previous).toHaveAttribute('aria-disabled', 'false');
		expect(document.activeElement).toBe(next);

		await fireEvent.keyDown(next, { key: 'ArrowLeft' });
		expect(next).toHaveAttribute('aria-disabled', 'false');
	});

	test('arrows appear when a resize makes the cards overflow', async () => {
		embla.reset(0);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});
		await vi.waitFor(() => expect(screen.getByText('2019 Honda Civic')).toBeInTheDocument());
		expect(screen.queryByRole('button', { name: 'Next slide' })).toBeNull();

		embla.resize(1);

		const next = await screen.findByRole('button', { name: 'Next slide' });
		expect(next).toHaveAttribute('aria-disabled', 'false');
		expect(screen.getByRole('button', { name: 'Previous slide' })).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	});

	test('focus moves to the carousel when a resize removes the focused arrow', async () => {
		embla.reset(1);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});
		const next = await screen.findByRole('button', { name: 'Next slide' });
		next.focus();

		embla.resize(0);

		await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Next slide' })).toBeNull());
		expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Your Fleet' }));
	});

	test('the carousel region is named after the card title and shows the kit focus ring', () => {
		embla.reset(1);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});
		const region = screen.getByRole('region', { name: 'Your Fleet' });
		expect(region.getAttribute('aria-roledescription')).toBe('carousel');
		expect(region.className).toContain('focus-visible:ring-[3px]');
		expect(region.className).toContain('focus-visible:ring-ring/50');
		expect(region.className).toContain('outline-none');
	});

	test('a resize that removes the arrows leaves focus elsewhere alone', async () => {
		embla.reset(1);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })]
		});
		await screen.findByRole('button', { name: 'Next slide' });
		const card = screen.getByRole('link', { name: '2019 Honda Civic' });
		card.focus();

		embla.resize(0);

		await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Next slide' })).toBeNull());
		expect(document.activeElement).toBe(card);
	});

	test('the arrows sit in the Your Fleet header next to Add Vehicle, not over the cards', async () => {
		embla.reset(1);
		render(VehicleCarousel, {
			vehicles: [overview(), overview({ id: 'v2', name: '2019 Honda Civic' })],
			addVehicleHref: '/vehicles/new'
		});
		const next = await screen.findByRole('button', { name: 'Next slide' });
		const region = screen.getByRole('region', { name: 'Your Fleet' });
		const header = screen
			.getByRole('heading', { level: 2, name: 'Your Fleet' })
			.closest('[data-slot="card-header"]');

		for (const arrow of [next, screen.getByRole('button', { name: 'Previous slide' })]) {
			expect(region).not.toContainElement(arrow);
			expect(header).toContainElement(arrow);
			expect(arrow.className).not.toMatch(/(^|\s)absolute(\s|$)/);
		}
		const add = screen.getByRole('link', { name: 'Add Vehicle' });
		expect(header).toContainElement(add);
		expect(add).toHaveClass('max-sm:w-10');
		expect(add.querySelector('span')).toHaveClass('max-sm:sr-only');
	});
});

describe('VehicleCarousel vehicle card', () => {
	test('a nickname is the link text and the full name is shown beneath it', () => {
		render(VehicleCarousel, { vehicles: [overview({ nickname: 'Daily Driver' })] });

		expect(screen.getByRole('link', { name: 'Daily Driver' })).toBeInTheDocument();
		expect(screen.getByText('2020 Toyota Camry')).toBeInTheDocument();
	});

	test('the card link shows the kit focus ring', () => {
		render(VehicleCarousel, { vehicles: [overview()] });

		const link = screen.getByRole('link', { name: '2020 Toyota Camry' });
		expect(link).toHaveClass(
			'outline-none',
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring/50'
		);
		expect(link).not.toHaveClass('focus-visible:ring-2');
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

	test('the fleet is an h2 and each vehicle name an h3 beneath it', () => {
		render(VehicleCarousel, { vehicles: [overview({ nickname: 'Daily Driver' })] });

		expect(screen.getByRole('heading', { level: 2, name: 'Your Fleet' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { level: 3, name: 'Daily Driver' })).toBeInTheDocument();
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

describe('VehicleCarousel compact header', () => {
	test('a vehicle without a cover photo has no image area, only a 40px type avatar beside its name', () => {
		render(VehicleCarousel, {
			vehicles: [overview({ make: 'Toyota', vehicleType: 'gas' })]
		});
		expect(screen.queryByTestId('fleet-card-header')).toBeNull();
		const avatar = screen.getByTestId('fleet-card-avatar');
		expect(avatar).toHaveClass('size-10', 'rounded-full');
		expect(avatar.parentElement).toContainElement(screen.getByRole('heading', { level: 3 }));
	});

	test('a cover photo keeps the full 160px image', () => {
		render(VehicleCarousel, {
			vehicles: [overview({ coverPhotoUrl: '/photo.jpg', make: 'Toyota' })]
		});
		const band = screen.getByTestId('fleet-card-header');
		expect(band).toHaveClass('h-40');
		const img = band.querySelector('img');
		expect(img).toHaveAttribute('src', '/photo.jpg');
		expect(img).toHaveClass('sm:group-hover:scale-110');
		expect(img?.className).not.toMatch(/(^|\s)group-hover:scale/);
		expect(screen.queryByTestId('fleet-card-avatar')).toBeNull();
	});

	test('below lg the Your Fleet header carries Add Vehicle when the page hands it a link', () => {
		render(VehicleCarousel, { vehicles: [overview()], addVehicleHref: '/vehicles/new' });
		const add = screen.getByRole('link', { name: 'Add Vehicle' });
		expect(add).toHaveAttribute('href', '/vehicles/new');
		expect(add).toHaveClass('lg:hidden');
	});

	test('the Financed and Shared badges sit beside the title, clear of the photo', () => {
		render(VehicleCarousel, {
			vehicles: [
				overview({
					hasActiveFinancing: true,
					sharedBy: 'Sam',
					make: 'Toyota',
					coverPhotoUrl: '/p.jpg'
				})
			]
		});
		const band = screen.getByTestId('fleet-card-header');
		const title = screen.getByRole('heading', { level: 3 });
		for (const badge of [screen.getByText('Financed'), screen.getByText('Shared by Sam')]) {
			expect(band).not.toContainElement(badge);
			expect(title.parentElement?.parentElement).toContainElement(badge);
		}
	});

	test('without a link the header shows no Add Vehicle', () => {
		render(VehicleCarousel, { vehicles: [overview()] });
		expect(screen.queryByRole('link', { name: 'Add Vehicle' })).toBeNull();
	});
});
