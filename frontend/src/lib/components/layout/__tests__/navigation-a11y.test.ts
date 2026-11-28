import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
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
		sheetsSyncEnabled: store(false),
		providerNeedsAttention: store(false)
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
	describe.each([
		['at lg and up', true],
		['on a phone', false]
	])('%s', (_where, isWide) => {
		if (isWide) onWideScreen();

		it('marks the current route with aria-current and nothing else', () => {
			render(Navigation);
			const nav = screen.getByRole('navigation', { name: 'Main' });

			expect(within(nav).getByRole('link', { name: 'Log' })).toHaveAttribute(
				'aria-current',
				'page'
			);
			expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
			expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
		});
	});

	it('lights More on a page that lives under it', () => {
		currentUrl = new URL('http://localhost/settings');
		render(Navigation);

		expect(screen.getByRole('button', { name: 'More' })).toHaveClass('text-bar-on');
		expect(screen.getByRole('link', { name: 'Log' })).not.toHaveAttribute('aria-current');
	});
});

describe('one navigation landmark, every item labelled in text', () => {
	describe('at lg and up', () => {
		onWideScreen();

		it('at lg and up: Home, Log, Garage, Explore, Reminders and More in a pill nav', () => {
			const { container } = render(Navigation);

			const landmarks = container.querySelectorAll('nav, [role="navigation"]');
			expect(landmarks).toHaveLength(1);
			const nav = landmarks[0] as HTMLElement;
			expect([...nav.querySelectorAll('a, button')].map(item => item.textContent?.trim())).toEqual([
				'Home',
				'Log',
				'Garage',
				'Explore',
				'Reminders',
				'More'
			]);
			expect(screen.getByRole('link', { name: 'Add expense' })).toHaveAttribute(
				'href',
				'/expenses/new'
			);
		});
	});

	it('on a phone: Home, Log, the raised Add, Garage and More in the bottom bar', () => {
		const { container } = render(Navigation);

		const landmarks = container.querySelectorAll('nav, [role="navigation"]');
		expect(landmarks).toHaveLength(1);
		const bar = landmarks[0] as HTMLElement;
		expect([...bar.querySelectorAll('a, button')].map(item => item.textContent?.trim())).toEqual([
			'Home',
			'Log',
			'Add',
			'Garage',
			'More'
		]);
		const add = within(bar).getByRole('link', { name: 'Add expense' });
		expect(add).toHaveAttribute('href', '/expenses/new');
		expect(bar).toHaveClass('bg-bar', 'text-bar-fg');
		expect(add.querySelector('span')).toHaveClass(
			'group-focus-visible:ring-bar-on',
			'group-focus-visible:outline-foreground'
		);
	});

	it('on a phone, the bottom bar has a top hairline in dark mode', () => {
		const { container } = render(Navigation);

		expect(container.querySelector('nav.fixed.bottom-0')).toHaveClass(
			'dark:border-t',
			'dark:border-border'
		);
	});

	it('on a phone, a form hides the bar: the form carries its own Save', () => {
		currentUrl = new URL('http://localhost/expenses/new');
		const { container } = render(Navigation);

		expect(container.querySelector('nav')).toBeNull();
		expect(screen.getByRole('link', { name: /Profile$/ })).toBeInTheDocument();
	});
});

describe('More opens a focus-trapping layer that Escape closes', () => {
	describe('at lg and up', () => {
		onWideScreen();

		it('at lg and up, a menu of Insurance, Trips, Assistant, Settings, Profile and Sign out', async () => {
			render(Navigation);
			const trigger = screen.getByRole('button', { name: 'More' });

			await fireEvent.click(trigger);
			const menu = await screen.findByRole('dialog', { name: 'More' });
			expect([...menu.querySelectorAll('a, button')].map(item => item.textContent?.trim())).toEqual(
				['Insurance', 'Trips', 'Assistant', 'Settings', 'Profile', 'Sign out']
			);
			await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));

			await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
			await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull());
			await waitFor(() => expect(document.activeElement).toBe(trigger));
		});
	});

	it('on a phone, a bottom sheet of everything the bar does not hold', async () => {
		render(Navigation);

		await fireEvent.click(screen.getByRole('button', { name: 'More' }));
		const sheet = await screen.findByRole('dialog', { name: 'More' });
		expect(
			[...sheet.querySelectorAll('li a, li button')].map(item => item.textContent?.trim())
		).toEqual([
			'Explore',
			'Reminders',
			'Insurance',
			'Trips',
			'Assistant',
			'Settings',
			'Profile',
			'Sign out'
		]);
		await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull());
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

	it('sits in a status region that does not announce every change', () => {
		offlineExpenseQueue.current = [row({ id: 'pending' })];
		render(Navigation);

		const status = screen.getAllByRole('status').find(region => region.textContent === '1 pending');
		expect(status).toHaveAttribute('aria-live', 'off');
		const spoken = screen.getByTestId('sync-status-announcement');
		expect(spoken).toHaveAttribute('aria-live', 'polite');
		expect(spoken).toHaveTextContent('Up to date');
	});
});

describe('only the navigation for the screen width is rendered', () => {
	it('below lg, the phone top bar and bottom bar, with no pill nav', () => {
		const { container } = render(Navigation);

		expect(container.querySelector('header.fixed.top-0')).toHaveClass('short:static');
		expect(container.querySelector('nav.fixed.bottom-0')).not.toBeNull();
		expect(container.querySelector('nav.rounded-full')).toBeNull();
	});

	it('below lg, auto-sync still starts on its own, with no menu opened', async () => {
		const { syncManager } = await import('#lib/utils/sync/sync-manager.ts');
		vi.mocked(syncManager.setupAutoSync).mockClear();

		render(Navigation);

		expect(syncManager.setupAutoSync).toHaveBeenCalledOnce();
		expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
	});

	describe('at lg and up', () => {
		onWideScreen();

		it('the pill nav in a header that scrolls with the page, with no bottom bar', () => {
			const { container } = render(Navigation);

			expect(container.querySelector('nav.rounded-full')).not.toBeNull();
			expect(container.querySelector('header')).not.toHaveClass('fixed');
			expect(container.querySelector('nav.fixed.bottom-0')).toBeNull();
		});
	});
});

describe('tap targets', () => {
	it('the header account avatar is a 40px target', () => {
		render(Navigation);

		const avatar = screen.getByRole('link', { name: /Profile$/ });
		expect(avatar).toHaveClass('size-10');
		expect(avatar).not.toHaveClass('size-9');
	});
});
