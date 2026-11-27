import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const edits = vi.hoisted(() => ({
	applyMyChanges: vi.fn(),
	reloadLatest: vi.fn(() => Promise.resolve()),
	retryEdit: vi.fn()
}));
vi.mock('#lib/utils/pending-edits.svelte.ts', () => edits);

import PendingSyncNote from '../PendingSyncNote.svelte';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const conflict = {
	status: 'failed' as const,
	kind: 'edit' as const,
	error: 'This expense changed elsewhere',
	conflict: true
};

function mount() {
	render(PendingSyncNote, {
		pending: conflict,
		entryId: 'e1',
		returnTo: '/expenses',
		label: 'Fuel on Nov 20'
	});
}

describe('a row whose edit was refused because it changed elsewhere', () => {
	test('says so and offers Apply my changes and Reload, not Retry', () => {
		mount();
		expect(screen.getByTestId('edit-conflict-note')).toHaveTextContent(
			'This expense changed elsewhere'
		);
		expect(screen.getByRole('button', { name: 'Apply my changes to Fuel on Nov 20' })).toBeTruthy();
		expect(
			screen.getByRole('button', { name: 'Reload Fuel on Nov 20 without my changes' })
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
	});

	test('Apply my changes re-sends the edit', async () => {
		mount();
		await fireEvent.click(screen.getByRole('button', { name: /Apply my changes/ }));
		expect(edits.applyMyChanges).toHaveBeenCalledWith('e1');
	});

	test('Reload refreshes only this expense, without reloading the page', async () => {
		const reload = vi.fn();
		vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
		mount();
		await fireEvent.click(screen.getByRole('button', { name: /^Reload/ }));
		expect(edits.reloadLatest).toHaveBeenCalledWith('e1');
		expect(reload).not.toHaveBeenCalled();
	});
});
