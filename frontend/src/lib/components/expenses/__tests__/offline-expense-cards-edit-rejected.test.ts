import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

const OfflineExpenseCards = (await import('../OfflineExpenseCards.svelte')).default;

const rejected: OfflineExpense = {
	id: 'offline_1_abc',
	vehicleId: 'v1',
	tags: [],
	category: 'maintenance',
	amount: 1_000_001,
	date: '2026-01-05',
	timestamp: 0,
	synced: false,
	version: '3.0',
	needsAttention: true,
	attentionReason: 'Amount must be 1,000,000 or less'
};

function renderCards(needsAttentionExpenses: OfflineExpense[]) {
	render(OfflineExpenseCards, {
		props: {
			pendingExpenses: [],
			needsAttentionExpenses,
			syncedExpenses: [],
			onRemovePending: vi.fn()
		}
	});
}

describe('OfflineExpenseCards — an entry the server rejected', () => {
	it("says the server didn't accept it, with the server's reason", () => {
		renderCards([rejected]);

		expect(
			screen.getByText("The server didn't accept this entry: Amount must be 1,000,000 or less")
		).toBeInTheDocument();
	});

	it('offers an Edit link that opens the entry in the expense form', () => {
		renderCards([rejected]);

		const edit = screen.getByRole('link', { name: /^Edit / });
		expect(edit).toHaveAttribute('href', '/expenses/new?queued=offline_1_abc');
	});

	it('offers no Edit for an entry that already reached the server', () => {
		renderCards([{ ...rejected, serverId: 'server-1', attentionReason: 'A photo failed' }]);

		expect(screen.queryByRole('link', { name: /^Edit / })).toBeNull();
	});

	it('keeps an incomplete fill-up reason as it is', () => {
		renderCards([
			{ ...rejected, category: 'fuel', amount: 40, attentionReason: 'Add the fuel amount' }
		]);

		expect(screen.getByText('Add the fuel amount')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /^Edit / })).toBeInTheDocument();
	});
});
