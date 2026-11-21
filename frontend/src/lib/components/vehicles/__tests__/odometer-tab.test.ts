import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { OdometerEntry, PaginatedResponse, UnitPreferences } from '#lib/types/index.ts';

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

const getEntries =
	vi.fn<
		(
			vehicleId: string,
			params: { limit: number; offset: number }
		) => Promise<PaginatedResponse<OdometerEntry>>
	>();
const deleteEntry = vi.fn<(entryId: string) => Promise<void>>();

vi.mock('#lib/services/odometer-api.ts', () => ({
	odometerApi: {
		getEntries: (vehicleId: string, params: { limit: number; offset: number }) =>
			getEntries(vehicleId, params),
		delete: (entryId: string) => deleteEntry(entryId)
	}
}));

import OdometerTab from '../OdometerTab.svelte';

const KM: UnitPreferences = { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' };

function entry(overrides: Partial<OdometerEntry> = {}): OdometerEntry {
	return {
		id: 'o1',
		vehicleId: 'v1',
		odometer: 45000,
		recordedAt: '2026-03-15T12:00:00.000Z',
		createdAt: '2026-03-15T12:00:00.000Z',
		updatedAt: '2026-03-15T12:00:00.000Z',
		...overrides
	};
}

function page(
	data: OdometerEntry[],
	totalCount = data.length,
	offset = 0
): PaginatedResponse<OdometerEntry> {
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
	getEntries.mockResolvedValue(page([]));
	deleteEntry.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('OdometerTab load states', () => {
	test('shows a spinner while the first page is loading', async () => {
		getEntries.mockReturnValue(new Promise(() => {}));
		const { container } = mount();
		await settle();

		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(getEntries).toHaveBeenCalledWith('v1', { limit: 20, offset: 0 });
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

	test('a load failure shows the error and Try Again reloads from the first page', async () => {
		getEntries.mockRejectedValueOnce(new Error('Server unavailable'));
		getEntries.mockResolvedValueOnce(page([entry()]));
		mount();
		await settle();

		expect(screen.getByText('Failed to load odometer entries')).toBeInTheDocument();
		expect(screen.getByText('Server unavailable')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
		await settle();

		expect(getEntries).toHaveBeenCalledTimes(2);
		expect(getEntries).toHaveBeenLastCalledWith('v1', { limit: 20, offset: 0 });
		expect(screen.getByText('Readings (1)')).toBeInTheDocument();
	});

	test('a non-Error failure falls back to the generic message', async () => {
		getEntries.mockRejectedValueOnce('boom');
		mount();
		await settle();

		expect(screen.getAllByText('Failed to load odometer entries')).toHaveLength(2);
	});
});

describe('OdometerTab entry list', () => {
	test('each reading shows the formatted value, unit, date and note', async () => {
		getEntries.mockResolvedValue(
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
		getEntries.mockResolvedValue(page([entry({ odometer: 72000 })]));
		mount({ unitPreferences: KM });
		await settle();

		expect(screen.getByText(/72,000\s+km/)).toBeInTheDocument();
	});

	test('writers get Add Reading, edit and delete actions with an edit link back to the vehicle', async () => {
		getEntries.mockResolvedValue(page([entry({ id: 'o7' })]));
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
		getEntries.mockResolvedValue(page([entry()]));
		mount({ canWrite: false });
		await settle();

		expect(screen.getByText('Readings (1)')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Add Reading' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Edit reading' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete reading' })).toBeNull();
	});

	test('a single reading does not draw the mileage chart', async () => {
		getEntries.mockResolvedValue(page([entry()]));
		mount();
		await settle();

		expect(chartProps).toBeNull();
	});

	test('two or more readings draw the chart in chronological order', async () => {
		getEntries.mockResolvedValue(
			page([
				entry({ id: 'b', odometer: 46000, recordedAt: '2026-04-01T12:00:00.000Z' }),
				entry({ id: 'a', odometer: 45000, recordedAt: '2026-03-01T12:00:00.000Z' })
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

describe('OdometerTab pagination', () => {
	function readings(count: number, start = 0): OdometerEntry[] {
		return Array.from({ length: count }, (_, i) =>
			entry({ id: `o${start + i}`, odometer: 1000 + start + i })
		);
	}

	test('a single page hides the pager', async () => {
		getEntries.mockResolvedValue(page(readings(3)));
		mount();
		await settle();

		expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
	});

	test('Next and Previous move through pages of 20', async () => {
		getEntries.mockResolvedValueOnce(page(readings(20), 25, 0));
		getEntries.mockResolvedValueOnce(page(readings(5, 20), 25, 20));
		getEntries.mockResolvedValueOnce(page(readings(20), 25, 0));
		mount();
		await settle();

		expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();

		await fireEvent.click(screen.getByRole('button', { name: /Next/ }));
		await settle();

		expect(getEntries).toHaveBeenLastCalledWith('v1', { limit: 20, offset: 20 });
		expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();

		await fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
		await settle();

		expect(getEntries).toHaveBeenLastCalledWith('v1', { limit: 20, offset: 0 });
		expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
	});

	test('shows a spinner inside the list while another page loads', async () => {
		getEntries.mockResolvedValueOnce(page(readings(20), 25, 0));
		getEntries.mockReturnValueOnce(new Promise(() => {}));
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
		getEntries.mockResolvedValue(page([entry({ id: 'o9', odometer: value })]));
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
		getEntries.mockResolvedValue(page([]));

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(deleteEntry).toHaveBeenCalledWith('o9');
		expect(getEntries).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByText('No odometer readings yet')).toBeInTheDocument();
	});

	test('a failed delete keeps the dialog open and shows the error', async () => {
		deleteEntry.mockRejectedValueOnce(new Error('Reading is linked to a trip'));
		const dialog = await openDeleteFor(45210);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Reading is linked to a trip')).toBeInTheDocument();
		expect(getEntries).toHaveBeenCalledTimes(1);
	});

	test('a non-Error delete failure shows the generic message', async () => {
		deleteEntry.mockRejectedValueOnce('boom');
		const dialog = await openDeleteFor(45210);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();

		expect(screen.getByText('Failed to delete reading')).toBeInTheDocument();
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
