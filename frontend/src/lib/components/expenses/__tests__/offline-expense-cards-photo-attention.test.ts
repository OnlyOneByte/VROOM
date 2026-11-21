import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

const OfflineExpenseCards = (await import('../OfflineExpenseCards.svelte')).default;

const savedWithRejectedPhoto: OfflineExpense = {
	id: 'parked-photo',
	vehicleId: 'v1',
	tags: [],
	category: 'maintenance',
	amount: 42,
	date: '2026-01-05',
	timestamp: 0,
	synced: false,
	version: '3.0',
	needsAttention: true,
	attentionReason: "A photo couldn't be uploaded: File too large",
	serverId: 'server-1'
};

describe('OfflineExpenseCards — an expense that synced but whose photo was rejected', () => {
	it('says the expense is saved and why the photo is waiting', () => {
		render(OfflineExpenseCards, {
			props: {
				pendingExpenses: [],
				needsAttentionExpenses: [savedWithRejectedPhoto],
				syncedExpenses: [],
				onRemovePending: vi.fn()
			}
		});

		expect(
			screen.getByText("Saved on the server. A photo couldn't be uploaded: File too large")
		).toBeInTheDocument();
	});

	it('offers to discard only the photos, and says the expense stays', async () => {
		const onRemoveNeedsAttention = vi.fn();
		render(OfflineExpenseCards, {
			props: {
				pendingExpenses: [],
				needsAttentionExpenses: [savedWithRejectedPhoto],
				syncedExpenses: [],
				onRemovePending: vi.fn(),
				onRemoveNeedsAttention
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Discard this entry' }));

		expect(await screen.findByText("Discard the photos that didn't upload?")).toBeInTheDocument();
		expect(screen.getByText(/is saved on the server/)).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Discard photos' }));
		await waitFor(() => expect(onRemoveNeedsAttention).toHaveBeenCalledWith('parked-photo'));
	});
});
