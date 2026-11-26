import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { BackfillSummary } from '#lib/types/index.ts';

const previewBackfill = vi.fn<() => Promise<BackfillSummary>>();
const backfill = vi.fn<() => Promise<BackfillSummary & { batchId: string }>>();
const backfills = vi.fn<() => Promise<unknown[]>>();
const undoBackfill = vi.fn<() => Promise<{ reverted: number }>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: {
		previewBackfill: () => previewBackfill(),
		backfill: () => backfill(),
		backfills: () => backfills(),
		undoBackfill: () => undoBackfill()
	}
}));

import BackfillDialog, { rangeBounds } from '../BackfillDialog.svelte';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const summary = (total: number): BackfillSummary => ({
	total,
	trips: total,
	readings: 0,
	expenses: 0,
	byDriver: total ? [{ driverId: 'd1', name: 'Sam', count: total }] : []
});

const mount = () =>
	render(BackfillDialog, {
		props: {
			open: true,
			vehicleId: 'car',
			drivers: [{ id: 'd1', userId: 'u1', name: 'Sam', color: null, archived: false }]
		}
	});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('BackfillDialog', () => {
	test('shows what will change before saving anything, then saves on request', async () => {
		previewBackfill.mockResolvedValue(summary(3));
		backfills.mockResolvedValue([]);
		backfill.mockResolvedValue({ ...summary(3), batchId: 'b1' });
		mount();
		await settle();
		expect(screen.getByRole('status').textContent).toContain('3 trips');
		expect(backfill).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Fill in 3' }));
		await settle();
		expect(backfill).toHaveBeenCalledTimes(1);
	});

	test('nothing to fill in leaves the button off', async () => {
		previewBackfill.mockResolvedValue(summary(0));
		backfills.mockResolvedValue([]);
		mount();
		await settle();
		expect(screen.getByRole('status').textContent).toContain('Nothing to fill in');
		expect((screen.getByRole('button', { name: 'Fill in' }) as HTMLButtonElement).disabled).toBe(
			true
		);
	});

	test('says so when the preview fails, and keeps the button off', async () => {
		previewBackfill.mockRejectedValue(new Error('offline'));
		backfills.mockResolvedValue([]);
		mount();
		await settle();
		expect(screen.getByRole('status').textContent).toContain("Couldn't work out");
		expect((screen.getByRole('button', { name: 'Fill in' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		previewBackfill.mockResolvedValue(summary(2));
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(screen.getByRole('status').textContent).toContain('2 trips');
	});

	test('a date range covers whole local days, from midnight to the end of the last day', () => {
		const { from, to } = rangeBounds('2024-03-01', '2024-03-31');
		expect(new Date(from)).toEqual(new Date(2024, 2, 1, 0, 0, 0, 0));
		expect(new Date(to)).toEqual(new Date(2024, 2, 31, 23, 59, 59, 999));
	});

	test('a recent fill-in can be undone', async () => {
		previewBackfill.mockResolvedValue(summary(0));
		backfills.mockResolvedValue([
			{ id: 'b1', mode: 'logged', createdAt: '2026-11-20T10:00:00.000Z', total: 4 }
		]);
		undoBackfill.mockResolvedValue({ reverted: 4 });
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await settle();
		expect(undoBackfill).toHaveBeenCalledTimes(1);
	});
});
