import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
const retryEntry = vi.hoisted(() => vi.fn());
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({ syncManager: { retryEntry } }));
const removeOfflineExpense = vi.hoisted(() => vi.fn());
vi.mock('#lib/utils/offline-storage.ts', () => ({ removeOfflineExpense }));

const PendingSyncNote = (await import('../PendingSyncNote.svelte')).default;

const props = { entryId: 'offline_1', returnTo: '/expenses?category=fuel', label: '$40.00 Arco' };

describe('PendingSyncNote', () => {
	test('a row that is still saving is marked Unsynced, with no actions', () => {
		render(PendingSyncNote, { props: { ...props, pending: { status: 'saving' } } });

		expect(screen.getByText('Unsynced')).toBeInTheDocument();
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('a refused row says why, offers Retry, and Edit opens the saved entry and comes back', async () => {
		render(PendingSyncNote, {
			props: { ...props, pending: { status: 'failed', error: 'Mileage too low', editable: true } }
		});

		expect(screen.getByText('Not saved: Mileage too low')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Edit $40.00 Arco' })).toHaveAttribute(
			'href',
			'/expenses/new?queued=offline_1&returnTo=%2Fexpenses%3Fcategory%3Dfuel'
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry saving $40.00 Arco' }));
		expect(retryEntry).toHaveBeenCalledWith('offline_1');
	});

	test('a row that failed on a network error offers Retry and Discard, not Edit', () => {
		render(PendingSyncNote, {
			props: { ...props, pending: { status: 'failed', error: 'Server down', editable: false } }
		});

		expect(screen.getByRole('button', { name: 'Retry saving $40.00 Arco' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull();
	});

	test('a failed edit or delete keeps its reason but offers no Retry or Edit without write access', () => {
		const edit = { status: 'failed', kind: 'edit', error: 'Server down' } as const;
		const writer = render(PendingSyncNote, { props: { ...props, pending: edit } });
		expect(
			screen.getByRole('button', { name: 'Retry saving changes to $40.00 Arco' })
		).toBeVisible();
		expect(screen.getByRole('link', { name: 'Edit $40.00 Arco' })).toBeVisible();
		writer.unmount();

		const reader = render(PendingSyncNote, { props: { ...props, pending: edit, canWrite: false } });
		expect(screen.getByText('Changes not saved: Server down')).toBeInTheDocument();
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.queryByRole('link')).toBeNull();
		reader.unmount();

		render(PendingSyncNote, {
			props: {
				...props,
				pending: { status: 'failed', kind: 'delete', error: 'Server down' },
				canWrite: false
			}
		});
		expect(screen.getByText('Not deleted: Server down')).toBeInTheDocument();
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('Discard asks first, then removes the entry from this device', async () => {
		render(PendingSyncNote, {
			props: { ...props, pending: { status: 'failed', error: 'Mileage too low', editable: true } }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Discard $40.00 Arco' }));
		expect(removeOfflineExpense).not.toHaveBeenCalled();
		expect(await screen.findByText('Discard this unsynced expense?')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(removeOfflineExpense).toHaveBeenCalledWith('offline_1');
	});
});
