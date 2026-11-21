import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

const OfflineExpenseCards = (await import('../OfflineExpenseCards.svelte')).default;

function entry(id: string, overrides: Partial<OfflineExpense> = {}): OfflineExpense {
	return {
		id,
		vehicleId: 'v1',
		tags: [],
		category: 'maintenance',
		amount: 42,
		date: '2026-01-05',
		timestamp: 0,
		synced: false,
		version: '3.0',
		...overrides
	};
}

function renderCards() {
	const onRemovePending = vi.fn();
	const onRemoveNeedsAttention = vi.fn();
	render(OfflineExpenseCards, {
		props: {
			pendingExpenses: [entry('pending-1')],
			needsAttentionExpenses: [entry('parked-1', { needsAttention: true })],
			syncedExpenses: [],
			onRemovePending,
			onRemoveNeedsAttention
		}
	});
	return { onRemovePending, onRemoveNeedsAttention };
}

describe('OfflineExpenseCards — discarding an unsynced entry', () => {
	it('asks first and names what will be lost', async () => {
		const { onRemovePending } = renderCards();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete pending expense' }));

		expect(onRemovePending).not.toHaveBeenCalled();
		expect(await screen.findByText('Discard this unsynced expense?')).toBeInTheDocument();
		expect(screen.getByText(/was never synced to the server/)).toBeInTheDocument();
	});

	it('removes the entry only after Discard is confirmed', async () => {
		const { onRemovePending } = renderCards();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete pending expense' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));

		await waitFor(() => expect(onRemovePending).toHaveBeenCalledWith('pending-1'));
	});

	it('keeps the entry when the user cancels', async () => {
		const { onRemoveNeedsAttention } = renderCards();

		await fireEvent.click(screen.getByRole('button', { name: 'Discard this entry' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		await waitFor(() =>
			expect(screen.queryByText('Discard this unsynced expense?')).not.toBeInTheDocument()
		);
		expect(onRemoveNeedsAttention).not.toHaveBeenCalled();
	});

	it('confirms a needs-attention entry through its own handler', async () => {
		const { onRemovePending, onRemoveNeedsAttention } = renderCards();

		await fireEvent.click(screen.getByRole('button', { name: 'Discard this entry' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));

		await waitFor(() => expect(onRemoveNeedsAttention).toHaveBeenCalledWith('parked-1'));
		expect(onRemovePending).not.toHaveBeenCalled();
	});
});
