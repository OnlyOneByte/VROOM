import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CalendarFeedInfo, CalendarFeedOptions } from '#lib/services/calendar-api.ts';

const OPTIONS: CalendarFeedOptions = {
	reminders: true,
	insurance: true,
	loans: true,
	vehicleNames: false,
	amounts: false
};

const getFeed = vi.fn<() => Promise<CalendarFeedInfo | null>>();
const createFeed =
	vi.fn<(o?: Partial<CalendarFeedOptions>) => Promise<{ feed: CalendarFeedInfo; path: string }>>();
const updateOptions = vi.fn<(o: Partial<CalendarFeedOptions>) => Promise<CalendarFeedInfo>>();
const turnOff = vi.fn<() => Promise<void>>();
vi.mock('#lib/services/calendar-api.ts', () => ({
	calendarApi: {
		getFeed: () => getFeed(),
		createFeed: (o?: Partial<CalendarFeedOptions>) => createFeed(o),
		updateOptions: (o: Partial<CalendarFeedOptions>) => updateOptions(o),
		turnOff: () => turnOff()
	}
}));

const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { showSuccess, showError } }));

const CalendarFeedCard = (await import('../CalendarFeedCard.svelte')).default;

const FEED: CalendarFeedInfo = {
	options: OPTIONS,
	createdAt: '2026-11-20T12:00:00.000Z',
	lastUsedAt: null
};
const PATH = `/calendar/feed/${'a'.repeat(43)}.ics`;
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
	vi.clearAllMocks();
	createFeed.mockResolvedValue({ feed: FEED, path: PATH });
	updateOptions.mockImplementation(async o => ({ ...FEED, options: { ...OPTIONS, ...o } }));
	turnOff.mockResolvedValue();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('CalendarFeedCard', () => {
	test('without a link, names and amounts are off and creating shows the link once', async () => {
		getFeed.mockResolvedValue(null);
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh)');
		render(CalendarFeedCard);
		const create = await screen.findByTestId('calendar-create');
		expect(screen.getByTestId('calendar-vehicleNames')).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByTestId('calendar-amounts')).toHaveAttribute('aria-checked', 'false');

		await fireEvent.click(create);
		const url = (await screen.findByLabelText('Your private calendar link')) as HTMLInputElement;
		expect(url.value).toBe(new URL(`/api/v1${PATH}`, window.location.origin).href);
		expect(createFeed).toHaveBeenCalledWith({ ...OPTIONS, timeZone: TIME_ZONE });
		const assign = vi.fn();
		vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
		await fireEvent.click(screen.getByRole('button', { name: 'Open in Apple Calendar' }));
		expect(assign).toHaveBeenCalledWith(url.value.replace(/^https?:/, 'webcal:'));
	});

	test('an existing link shows its dates but never the link itself', async () => {
		getFeed.mockResolvedValue({ ...FEED, lastUsedAt: '2026-11-22T08:00:00.000Z' });
		render(CalendarFeedCard);
		expect(await screen.findByTestId('calendar-status')).toHaveTextContent(/last used/);
		expect(screen.queryByTestId('calendar-link')).toBeNull();
	});

	test('switching an option on an existing link saves just that option', async () => {
		getFeed.mockResolvedValue(FEED);
		render(CalendarFeedCard);
		await fireEvent.click(await screen.findByTestId('calendar-amounts'));
		await waitFor(() =>
			expect(updateOptions).toHaveBeenCalledWith({ amounts: true, timeZone: TIME_ZONE })
		);
	});

	test('turning the link off asks first, then revokes it', async () => {
		getFeed.mockResolvedValue(FEED);
		render(CalendarFeedCard);
		await fireEvent.click(await screen.findByTestId('calendar-off'));
		expect(turnOff).not.toHaveBeenCalled();
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn Off' })
		);
		await waitFor(() => expect(turnOff).toHaveBeenCalled());
		expect(await screen.findByTestId('calendar-create')).toBeInTheDocument();
	});

	test('a new link asks first, because the old one stops working', async () => {
		getFeed.mockResolvedValue(FEED);
		render(CalendarFeedCard);
		await fireEvent.click(await screen.findByTestId('calendar-rotate'));
		expect(createFeed).not.toHaveBeenCalled();
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Get a New Link' })
		);
		await waitFor(() => expect(createFeed).toHaveBeenCalled());
		expect(await screen.findByTestId('calendar-link')).toBeInTheDocument();
	});

	test('a failed new link keeps its dialog open so it can be retried', async () => {
		getFeed.mockResolvedValue(FEED);
		createFeed.mockRejectedValueOnce(new Error('offline'));
		render(CalendarFeedCard);
		await fireEvent.click(await screen.findByTestId('calendar-rotate'));
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Get a New Link' })
		);
		await waitFor(() => expect(showError).toHaveBeenCalled());
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});

	test('the Apple Calendar button only shows on Apple devices', async () => {
		getFeed.mockResolvedValue(null);
		vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0)');
		render(CalendarFeedCard);
		await fireEvent.click(await screen.findByTestId('calendar-create'));
		await screen.findByTestId('calendar-link');
		expect(screen.queryByRole('button', { name: 'Open in Apple Calendar' })).toBeNull();
	});

	test('a time zone the server rejects falls back to creating the link without one', async () => {
		const { ApiError } = await import('#lib/utils/error-handling.ts');
		getFeed.mockResolvedValue(null);
		createFeed.mockRejectedValueOnce(new ApiError('Unknown time zone', 400));
		render(CalendarFeedCard);
		await fireEvent.click(await screen.findByTestId('calendar-create'));
		await screen.findByTestId('calendar-link');
		expect(createFeed).toHaveBeenNthCalledWith(1, { ...OPTIONS, timeZone: TIME_ZONE });
		expect(createFeed).toHaveBeenNthCalledWith(2, OPTIONS);
	});
});
