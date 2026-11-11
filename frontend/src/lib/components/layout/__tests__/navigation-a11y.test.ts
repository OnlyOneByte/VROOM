/**
 * The desktop sidebar's three accessibility defects, and its pending badge.
 *
 * - The active page was signalled by colour alone: `isActive(href)` drove only a class swap, so
 *   assistive tech had no way to report which of the identical-sounding links was the current page.
 * - The labels were revealed by `onmouseenter` only, so a keyboard user tabbing the sidebar got bare
 *   icons — a mouse-only affordance.
 * - The wrapper `<div>` carried `role="navigation"` around the real `<nav>`, giving every
 *   authenticated route two nested, unlabelled navigation landmarks (axe landmark-unique). It still
 *   needs SOME role because it carries pointer handlers, so it is explicitly presentational.
 *
 * The badge assertions belong here because the sidebar is the third of the three chrome surfaces
 * that counted `!synced` and so advertised a parked row as syncable.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '$lib/stores/offline.svelte';
import type { OfflineExpense } from '$lib/utils/offline-storage';

vi.mock('svelte', () => import('../../../../../node_modules/svelte/src/index-client.js' as string));

let currentUrl = new URL('http://localhost/expenses');
vi.mock('$app/state', () => ({
	get page() {
		return { url: currentUrl };
	}
}));

vi.mock('$lib/utils/sync/sync-manager', () => {
	const store = <T>(value: T) => ({
		get current() {
			return value;
		}
	});
	return {
		syncManager: { setupAutoSync: vi.fn(), syncAll: vi.fn() },
		fetchLastSyncTime: vi.fn(),
		syncConflicts: store<unknown[]>([]),
		lastBackupTime: store<Date | null>(null),
		lastSheetsSync: store<Date | null>(null),
		lastDataChangeTime: store<Date | null>(null),
		backupEnabled: store(false),
		sheetsSyncEnabled: store(false)
	};
});

const Navigation = (await import('../Navigation.svelte')).default;

function row(overrides: Partial<OfflineExpense> & { id: string }): OfflineExpense {
	return {
		vehicleId: 'v1',
		tags: [],
		category: 'maintenance',
		amount: 42,
		date: '2026-01-05',
		timestamp: 1_767_600_000_000,
		synced: false,
		version: '3.0',
		...overrides
	};
}

beforeEach(() => {
	currentUrl = new URL('http://localhost/expenses');
	onlineStatus.current = true;
	syncState.current = 'idle';
	offlineExpenseQueue.current = [];
});

describe('active page is announced, not just coloured', () => {
	it('marks the current route with aria-current and nothing else', () => {
		render(Navigation);

		expect(screen.getByRole('link', { name: 'Expenses' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
		expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
	});

	it('follows the active route', () => {
		currentUrl = new URL('http://localhost/settings');
		render(Navigation);

		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'Expenses' })).not.toHaveAttribute('aria-current');
	});
});

describe('one navigation landmark', () => {
	it('exposes exactly one, and it is the <nav>', () => {
		const { container } = render(Navigation);

		const landmarks = container.querySelectorAll('nav, [role="navigation"]');
		expect(landmarks).toHaveLength(1);
		expect(landmarks[0]?.tagName).toBe('NAV');
	});
});

describe('labels reveal on keyboard focus, not only on hover', () => {
	it('expands when focus enters the sidebar and collapses when it leaves', async () => {
		render(Navigation);
		const expensesLink = screen.getByRole('link', { name: 'Expenses' });

		// Collapsed: the only accessible name is the title attribute, there is no label text.
		expect(screen.queryByText('Expenses')).toBeNull();

		await fireEvent.focusIn(expensesLink);
		expect(screen.getByText('Expenses')).toBeInTheDocument();

		await fireEvent.focusOut(expensesLink, { relatedTarget: null });
		expect(screen.queryByText('Expenses')).toBeNull();
	});

	it('stays expanded while focus moves between its own children', async () => {
		render(Navigation);
		const expensesLink = screen.getByRole('link', { name: 'Expenses' });

		await fireEvent.focusIn(expensesLink);
		const settingsLink = screen.getByRole('link', { name: 'Settings' });
		await fireEvent.focusOut(expensesLink, { relatedTarget: settingsLink });

		expect(screen.getByText('Expenses')).toBeInTheDocument();
	});
});

describe('pending badge', () => {
	it('does not count a parked row', () => {
		offlineExpenseQueue.current = [row({ id: 'parked', needsAttention: true })];
		render(Navigation);

		expect(screen.queryByLabelText(/pending items/)).toBeNull();
	});

	it('counts a genuinely pending row', () => {
		offlineExpenseQueue.current = [row({ id: 'pending' })];
		render(Navigation);

		expect(screen.getByLabelText('1 pending items')).toBeInTheDocument();
	});
});
