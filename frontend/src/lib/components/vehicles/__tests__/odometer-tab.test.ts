import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { scaleTime } from 'd3-scale';
import type { OdometerHistoryEntry, PaginatedResponse, UnitPreferences } from '#lib/types/index.ts';
import { UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params: Record<string, string> = {}) =>
		path.replace(/\[(\w+)\]/g, (_m, key: string) => params[key] ?? '')
}));

let chartProps: Record<string, unknown> | null = null;
vi.mock('#lib/components/charts/index.ts', () => ({
	AppLineChart: (_anchor: unknown, props: Record<string, unknown>) => {
		chartProps = props;
	}
}));

const getHistory =
	vi.fn<
		(
			vehicleId: string,
			params: { limit: number; offset: number }
		) => Promise<PaginatedResponse<OdometerHistoryEntry>>
	>();
const deleteEntry = vi.fn<(entryId: string) => Promise<void>>();

vi.mock('#lib/services/odometer-api.ts', () => ({
	odometerApi: {
		delete: (entryId: string) => deleteEntry(entryId)
	}
}));

vi.mock('#lib/services/odometer-history-api.ts', () => ({
	odometerHistoryApi: {
		getHistory: (vehicleId: string, params: { limit: number; offset: number }) =>
			getHistory(vehicleId, params)
	}
}));

import OdometerTab, { mileageXAxisProps, mileageYDomain } from '../OdometerTab.svelte';

const KM: UnitPreferences = { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' };

function entry(overrides: Partial<OdometerHistoryEntry> = {}): OdometerHistoryEntry {
	return {
		odometer: 45000,
		recordedAt: '2026-03-15T12:00:00.000Z',
		source: 'manual',
		sourceId: 'o1',
		note: null,
		...overrides
	};
}

function page(
	data: OdometerHistoryEntry[],
	totalCount = data.length,
	offset = 0
): PaginatedResponse<OdometerHistoryEntry> {
	return {
		data,
		pagination: { totalCount, limit: 20, offset, hasMore: offset + data.length < totalCount }
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

function mount(props: { canWrite?: boolean; unitPreferences?: UnitPreferences } = {}) {
	return render(OdometerTab, { props: { vehicleId: 'v1', ...props } });
}

beforeEach(() => {
	vi.clearAllMocks();
	chartProps = null;
	getHistory.mockResolvedValue(page([]));
	deleteEntry.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('OdometerTab load states', () => {
	test('shows a spinner while the first page is loading', async () => {
		getHistory.mockReturnValue(new Promise(() => {}));
		const { container } = mount();
		await settle();

		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(getHistory).toHaveBeenCalledWith('v1', { limit: 20, offset: 0 });
	});

	test('an empty history shows the empty state with an Add Reading link for writers', async () => {
		mount();
		await settle();

		expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add Reading' })).toHaveAttribute(
			'href',
			'/vehicles/v1/odometer/new'
		);
	});

	test('a read-only viewer sees the empty state without Add Reading', async () => {
		mount({ canWrite: false });
		await settle();

		expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Add Reading' })).toBeNull();
	});

	test('a load failure shows the error and Retry reloads from the first page', async () => {
		getHistory.mockRejectedValueOnce(new Error('Server unavailable'));
		getHistory.mockResolvedValueOnce(page([entry()]));
		mount();
		await settle();

		expect(screen.getByText("Couldn't load odometer readings")).toBeInTheDocument();
		expect(screen.getByText('Server unavailable.')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(getHistory).toHaveBeenCalledTimes(2);
		expect(getHistory).toHaveBeenLastCalledWith('v1', { limit: 20, offset: 0 });
		expect(screen.getByText('Readings (1)')).toBeInTheDocument();
	});

	test('a non-Error failure falls back to the generic message', async () => {
		getHistory.mockRejectedValueOnce('boom');
		mount();
		await settle();

		expect(screen.getByText("Couldn't load odometer readings")).toBeInTheDocument();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeInTheDocument();
	});
});

describe('OdometerTab entry list', () => {
	test('each reading shows the formatted value, unit, date and note', async () => {
		getHistory.mockResolvedValue(
			page([entry({ odometer: 45210, note: 'Oil change visit', recordedAt: '2026-03-15' })])
		);
		mount();
		await settle();

		expect(screen.getByText('Readings (1)')).toBeInTheDocument();
		expect(screen.getByText(/45,210\s+mi/)).toBeInTheDocument();
		expect(screen.getByText('Mar 15, 2026')).toBeInTheDocument();
		expect(screen.getByText('Oil change visit')).toBeInTheDocument();
	});

	test('vehicle unit preferences override the global distance unit', async () => {
		getHistory.mockResolvedValue(page([entry({ odometer: 72000 })]));
		mount({ unitPreferences: KM });
		await settle();

		expect(screen.getByText(/72,000\s+km/)).toBeInTheDocument();
	});

	test('writers get Add Reading, edit and delete actions with an edit link back to the vehicle', async () => {
		getHistory.mockResolvedValue(page([entry({ sourceId: 'o7' })]));
		mount();
		await settle();

		expect(screen.getByRole('link', { name: 'Add Reading' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Edit reading' })).toHaveAttribute(
			'href',
			'/vehicles/v1/odometer/o7/edit?returnTo=/vehicles/v1'
		);
		expect(screen.getByRole('button', { name: 'Delete reading' })).toBeInTheDocument();
	});

	test('read-only viewers see readings without any write actions', async () => {
		getHistory.mockResolvedValue(page([entry()]));
		mount({ canWrite: false });
		await settle();

		expect(screen.getByText('Readings (1)')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Add Reading' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Edit reading' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete reading' })).toBeNull();
	});

	test('a single reading does not draw the mileage chart', async () => {
		getHistory.mockResolvedValue(page([entry()]));
		mount();
		await settle();

		expect(chartProps).toBeNull();
	});

	test('two or more readings draw the chart in chronological order', async () => {
		getHistory.mockResolvedValue(
			page([
				entry({ sourceId: 'b', odometer: 46000, recordedAt: '2026-04-01T12:00:00.000Z' }),
				entry({ sourceId: 'a', odometer: 45000, recordedAt: '2026-03-01T12:00:00.000Z' })
			])
		);
		mount();
		await settle();

		expect(chartProps).not.toBeNull();
		const data = chartProps?.['data'] as { date: Date; odometer: number }[];
		expect(data.map(d => d.odometer)).toEqual([45000, 46000]);
		const yAxisFormat = chartProps?.['yAxisFormat'] as (v: number) => string;
		expect(yAxisFormat(123456)).toBe('123,456');
	});
});

describe('OdometerTab expense mileage', () => {
	const fromExpenses = [
		entry({ source: 'expense', sourceId: 'e2', odometer: 30120, recordedAt: '2026-04-01' }),
		entry({ source: 'expense', sourceId: 'e1', odometer: 29800, recordedAt: '2026-03-01' })
	];

	test('a vehicle with only expense mileage lists and charts it instead of the empty state', async () => {
		getHistory.mockResolvedValue(page(fromExpenses));
		mount();
		await settle();

		expect(screen.queryByText('No odometer readings yet')).toBeNull();
		expect(screen.getByText('Readings (2)')).toBeInTheDocument();
		expect(screen.getAllByText('expense')).toHaveLength(2);
		const data = chartProps?.['data'] as { odometer: number }[];
		expect(data.map(d => d.odometer)).toEqual([29800, 30120]);
	});

	test('an expense row links to its expense and has no reading edit or delete', async () => {
		getHistory.mockResolvedValue(page([fromExpenses[0] as OdometerHistoryEntry]));
		mount();
		await settle();

		expect(screen.getByRole('link', { name: 'Open expense' })).toHaveAttribute(
			'href',
			'/expenses/e2/edit?returnTo=/vehicles/v1'
		);
		expect(screen.queryByRole('link', { name: 'Edit reading' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete reading' })).toBeNull();
	});

	test('read-only viewers get no expense link', async () => {
		getHistory.mockResolvedValue(page(fromExpenses));
		mount({ canWrite: false });
		await settle();

		expect(screen.queryByRole('link', { name: 'Open expense' })).toBeNull();
	});

	test('the chart y axis fits the readings instead of starting at 0', async () => {
		getHistory.mockResolvedValue(page(fromExpenses));
		mount();
		await settle();

		const [low, high] = chartProps?.['yDomain'] as [number, number];
		expect(low).toBeGreaterThan(29000);
		expect(low).toBeLessThan(29800);
		expect(high).toBeGreaterThan(30120);
	});
});

describe('mileage chart axes', () => {
	test('the y domain pads the reading range by 10% each side', () => {
		const [low, high] = mileageYDomain([45000, 45300]);
		expect(low).toBeCloseTo(44970);
		expect(high).toBeCloseTo(45330);
	});

	test('equal readings still get a visible range, and it never goes below 0', () => {
		expect(mileageYDomain([45000, 45000])).toEqual([44550, 45450]);
		expect(mileageYDomain([0, 0])).toEqual([0, 1]);
		expect(mileageYDomain([10, 1000])[0]).toBe(0);
	});

	function tickLabels(dates: Date[], width = 300): string[] {
		const axis = mileageXAxisProps(dates);
		const times = dates.map(d => d.getTime());
		const scale = scaleTime()
			.domain([new Date(Math.min(...times)), new Date(Math.max(...times))])
			.range([0, width]);
		return (axis.ticks(scale as never) as Date[]).map(tick => axis.format(tick));
	}

	test('readings days apart get day labels, none repeated', () => {
		const labels = tickLabels([new Date(2026, 10, 15), new Date(2026, 10, 20)]);
		expect(labels.length).toBeGreaterThan(0);
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels.every(l => /^Nov \d+$/.test(l))).toBe(true);
	});

	test('readings months apart get month labels, none repeated', () => {
		const labels = tickLabels([
			new Date(2026, 0, 10),
			new Date(2026, 3, 1),
			new Date(2026, 6, 5),
			new Date(2026, 10, 20)
		]);
		expect(labels.length).toBeGreaterThan(1);
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels.every(l => /^(\d{4}|[A-Z][a-z]{2})$/.test(l))).toBe(true);
	});

	test('two readings on the same day give at most one label', () => {
		expect(
			tickLabels([new Date(2026, 10, 20, 8), new Date(2026, 10, 20, 18)]).length
		).toBeLessThanOrEqual(1);
	});
});

describe('OdometerTab pagination', () => {
	function readings(count: number, start = 0): OdometerHistoryEntry[] {
		return Array.from({ length: count }, (_, i) =>
			entry({ sourceId: `o${start + i}`, odometer: 1000 + start + i })
		);
	}

	test('a single page hides the pager', async () => {
		getHistory.mockResolvedValue(page(readings(3)));
		mount();
		await settle();

		expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
	});

	test('Next and Previous move through pages of 20', async () => {
		getHistory.mockResolvedValueOnce(page(readings(20), 25, 0));
		getHistory.mockResolvedValueOnce(page(readings(5, 20), 25, 20));
		getHistory.mockResolvedValueOnce(page(readings(20), 25, 0));
		mount();
		await settle();

		expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();

		await fireEvent.click(screen.getByRole('button', { name: /Next/ }));
		await settle();

		expect(getHistory).toHaveBeenLastCalledWith('v1', { limit: 20, offset: 20 });
		expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();

		await fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
		await settle();

		expect(getHistory).toHaveBeenLastCalledWith('v1', { limit: 20, offset: 0 });
		expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
	});

	test('shows a spinner inside the list while another page loads', async () => {
		getHistory.mockResolvedValueOnce(page(readings(20), 25, 0));
		getHistory.mockReturnValueOnce(new Promise(() => {}));
		const { container } = mount();
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: /Next/ }));
		await settle();

		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByText(/1,000/)).toBeNull();
		expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
	});
});

describe('OdometerTab delete', () => {
	async function openDeleteFor(value: number) {
		getHistory.mockResolvedValue(page([entry({ sourceId: 'o9', odometer: value })]));
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete reading' }));
		await settle();
		return screen.getByRole('dialog');
	}

	test('the confirmation names the reading being deleted', async () => {
		const dialog = await openDeleteFor(45210);

		expect(within(dialog).getByText(/45,210 mi/)).toBeInTheDocument();
		expect(within(dialog).getByText(/This action cannot be undone/)).toBeInTheDocument();
	});

	test('Cancel closes the dialog without deleting', async () => {
		const dialog = await openDeleteFor(45210);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		await settle();

		expect(deleteEntry).not.toHaveBeenCalled();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	test('confirming deletes the entry and reloads the current page', async () => {
		const dialog = await openDeleteFor(45210);
		getHistory.mockResolvedValue(page([]));

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(deleteEntry).toHaveBeenCalledWith('o9');
		expect(getHistory).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
	});

	test('a failed delete keeps the dialog open and shows the error', async () => {
		deleteEntry.mockRejectedValueOnce(new Error('Reading is linked to a trip'));
		const dialog = await openDeleteFor(45210);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(
			screen.getByText("Couldn't delete the reading. Reading is linked to a trip.")
		).toBeInTheDocument();
		expect(getHistory).toHaveBeenCalledTimes(1);
	});

	test('a non-Error delete failure shows the generic message', async () => {
		deleteEntry.mockRejectedValueOnce('boom');
		const dialog = await openDeleteFor(45210);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(
			screen.getByText(`Couldn't delete the reading. ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
	});

	test('the Delete button is disabled while the delete is in flight', async () => {
		deleteEntry.mockReturnValueOnce(new Promise(() => {}));
		const dialog = await openDeleteFor(45210);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
		).toBeDisabled();
	});
});
