import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { SyncConflict } from '$lib/utils/sync/sync-state.svelte';

const resolveConflict = vi.fn(async () => true);
vi.mock('$lib/utils/sync/sync-manager', async () => {
	const state = await import('$lib/utils/sync/sync-state.svelte');
	return { syncConflicts: state.syncConflicts, syncManager: { resolveConflict } };
});

const { syncConflicts } = await import('$lib/utils/sync/sync-state.svelte');
const SyncConflictResolver = (await import('../SyncConflictResolver.svelte')).default;

function conflict(id: string): SyncConflict {
	return {
		id,
		conflictType: 'duplicate',
		localExpense: {
			id,
			vehicleId: 'v1',
			tags: [],
			category: 'maintenance',
			amount: 42,
			date: '2026-01-05',
			timestamp: 1_767_600_000_000,
			synced: false,
			version: '3.0'
		}
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

const TITLE = 'Sync Conflict Detected';

beforeEach(() => {
	vi.clearAllMocks();
	syncConflicts.current = [];
});

describe('SyncConflictResolver dismissal', () => {
	it('opens itself when conflicts are queued', async () => {
		syncConflicts.current = [conflict('a'), conflict('b')];
		render(SyncConflictResolver);
		await settle();

		expect(screen.getByText(TITLE)).toBeInTheDocument();
		expect(screen.getByText('2 conflicts need resolution')).toBeInTheDocument();
	});

	it('Skip closes the dialog and leaves the conflicts queued', async () => {
		syncConflicts.current = [conflict('a'), conflict('b')];
		render(SyncConflictResolver);
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
		await settle();

		expect(screen.queryByText(TITLE)).toBeNull();
		expect(syncConflicts.current).toHaveLength(2);
		expect(resolveConflict).not.toHaveBeenCalled();
	});

	it('the X closes the dialog too', async () => {
		syncConflicts.current = [conflict('a')];
		render(SyncConflictResolver);
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: /close/i }));
		await settle();

		expect(screen.queryByText(TITLE)).toBeNull();
		expect(syncConflicts.current).toHaveLength(1);
	});

	it('a later sync run re-presents the deferred conflicts', async () => {
		const deferred = [conflict('a')];
		syncConflicts.current = deferred;
		render(SyncConflictResolver);
		await settle();

		await fireEvent.click(screen.getByRole('button', { name: /skip/i }));
		await settle();
		expect(screen.queryByText(TITLE)).toBeNull();

		syncConflicts.current = [...deferred];
		await settle();

		expect(screen.getByText(TITLE)).toBeInTheDocument();
	});
});
