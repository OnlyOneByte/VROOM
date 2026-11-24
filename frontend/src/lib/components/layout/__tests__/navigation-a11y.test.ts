import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '#lib/stores/offline.svelte.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { onWideScreen } from './wide-screen.ts';

let currentUrl = new URL('http://localhost/expenses');
vi.mock('$app/state', () => ({
	get page() {
		return { url: currentUrl };
	}
}));

vi.mock('#lib/utils/sync/sync-manager.ts', () => {
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
	onWideScreen();

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
	onWideScreen();

	it('exposes exactly one, and it is the <nav>', () => {
		const { container } = render(Navigation);

		const landmarks = container.querySelectorAll('nav, [role="navigation"]');
		expect(landmarks).toHaveLength(1);
		expect(landmarks[0]?.tagName).toBe('NAV');
	});
});

describe('labels reveal on keyboard focus, not only on hover', () => {
	onWideScreen();

	it('expands when focus enters the sidebar and collapses when it leaves', async () => {
		render(Navigation);
		const expensesLink = screen.getByRole('link', { name: 'Expenses' });

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

describe('fixed chrome on short viewports and at high zoom', () => {
	it('keeps focus clear of the fixed header and bars below lg, and lets the header scroll away on short screens', async () => {
		const css = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'app.css'),
			'utf8'
		);
		expect(css).toMatch(/@custom-variant short \(@media \(max-height: 500px\)\);/);
		expect(css).toMatch(
			/html \{\s*@variant max-lg \{\s*scroll-padding-top: calc\(4rem \+ env\(safe-area-inset-top\)\);\s*scroll-padding-bottom: 6rem;\s*\}\s*@variant short \{\s*scroll-padding-top: 0;/
		);

		const { container } = render(Navigation);
		const header = container.querySelector('.fixed.top-0');
		expect(header).toHaveClass('lg:hidden', 'short:static');
		expect(container.querySelector('.h-16')).toHaveClass('lg:hidden', 'short:hidden');
	});
});

describe('only the navigation for the screen width is rendered', () => {
	it('below lg, the mobile header without the desktop sidebar', () => {
		const { container } = render(Navigation);

		expect(container.querySelector('div.fixed.top-0')).not.toBeNull();
		expect(container.querySelector('div.lg\\:inset-y-0')).toBeNull();
	});

	it('below lg, auto-sync still starts on its own, with no menu opened', async () => {
		const { syncManager } = await import('#lib/utils/sync/sync-manager.ts');
		vi.mocked(syncManager.setupAutoSync).mockClear();

		render(Navigation);

		expect(syncManager.setupAutoSync).toHaveBeenCalledOnce();
		expect(screen.queryByRole('button', { name: 'Sync Now' })).toBeNull();
	});

	describe('at lg and up', () => {
		onWideScreen();

		it('the desktop sidebar without the mobile header', () => {
			const { container } = render(Navigation);

			expect(container.querySelector('div.lg\\:inset-y-0')).not.toBeNull();
			expect(container.querySelector('div.fixed.top-0')).toBeNull();
		});
	});
});
