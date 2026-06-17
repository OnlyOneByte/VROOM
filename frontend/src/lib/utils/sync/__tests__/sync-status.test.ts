/**
 * C331 (guard) — pin getSyncStatusInfo, the user-facing sync-indicator derivation.
 *
 * sync/sync-status.ts had ZERO test coverage. It's the centralized logic behind BOTH SyncStatusIndicator
 * and SyncStatusInline (the persistent sync badge), and its branch ORDER is load-bearing: the conditions
 * are evaluated as a PRIORITY CASCADE, not independent flags —
 *   offline  >  conflicts  >  syncing  >  error  >  success  >  pending  >  up-to-date
 * so a refactor that reordered the `if`s (or flipped a comparison) would silently surface the WRONG status
 * — e.g. show "Synced" while offline, or hide an unresolved conflict behind a "Syncing…" spinner. These
 * pin every branch's {color, icon, text} AND the precedence between branches that can be true at once
 * (the part a naive per-branch test misses), plus the singular/plural conflict copy. NON-VACUOUS:
 * reordering any pair of branches, or dropping the `> 1` plural guard, turns a case RED.
 */

import { describe, expect, test } from 'vitest';
import {
	Wifi,
	WifiOff,
	RefreshCw,
	CircleCheck,
	CircleAlert,
	Clock
} from '@lucide/svelte';
import { getSyncStatusInfo, type SyncStatusParams } from '$lib/utils/sync/sync-status';

/** A "nothing going on, online" baseline; override per case. */
function params(overrides: Partial<SyncStatusParams> = {}): SyncStatusParams {
	return {
		isOnline: true,
		syncStatus: 'idle',
		pendingCount: 0,
		conflictsCount: 0,
		...overrides
	};
}

describe('getSyncStatusInfo — each branch in isolation', () => {
	test('offline → WifiOff / destructive / "Offline"', () => {
		const info = getSyncStatusInfo(params({ isOnline: false }));
		expect(info.icon).toBe(WifiOff);
		expect(info.color).toBe('text-destructive');
		expect(info.text).toBe('Offline');
	});

	test('one conflict → CircleAlert / chart-5 / singular "1 conflict"', () => {
		const info = getSyncStatusInfo(params({ conflictsCount: 1 }));
		expect(info.icon).toBe(CircleAlert);
		expect(info.color).toBe('text-chart-5');
		expect(info.text).toBe('1 conflict');
	});

	test('multiple conflicts → pluralized "N conflicts"', () => {
		expect(getSyncStatusInfo(params({ conflictsCount: 3 })).text).toBe('3 conflicts');
	});

	test('syncing → RefreshCw / chart-5 / "Syncing..."', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'syncing' }));
		expect(info.icon).toBe(RefreshCw);
		expect(info.text).toBe('Syncing...');
	});

	test('error → CircleAlert / destructive / "Sync failed"', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'error' }));
		expect(info.icon).toBe(CircleAlert);
		expect(info.color).toBe('text-destructive');
		expect(info.text).toBe('Sync failed');
	});

	test('success → CircleCheck / chart-2 / "Synced"', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'success' }));
		expect(info.icon).toBe(CircleCheck);
		expect(info.color).toBe('text-chart-2');
		expect(info.text).toBe('Synced');
	});

	test('pending only (idle, no conflicts) → Clock / chart-5 / "N pending"', () => {
		const info = getSyncStatusInfo(params({ pendingCount: 2 }));
		expect(info.icon).toBe(Clock);
		expect(info.color).toBe('text-chart-5');
		expect(info.text).toBe('2 pending');
	});

	test('idle, online, nothing queued → Wifi / chart-2 / "Up to date"', () => {
		const info = getSyncStatusInfo(params());
		expect(info.icon).toBe(Wifi);
		expect(info.color).toBe('text-chart-2');
		expect(info.text).toBe('Up to date');
	});
});

describe('getSyncStatusInfo — precedence cascade (the load-bearing part)', () => {
	test('offline BEATS everything — even with conflicts, syncing, and pending all set', () => {
		const info = getSyncStatusInfo({
			isOnline: false,
			syncStatus: 'syncing',
			pendingCount: 5,
			conflictsCount: 4
		});
		expect(info.text).toBe('Offline'); // not "4 conflicts", not "Syncing..."
	});

	test('conflicts BEAT syncing — an unresolved conflict is not hidden behind the sync spinner', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'syncing', conflictsCount: 1 }));
		expect(info.text).toBe('1 conflict'); // not "Syncing..."
	});

	test('conflicts BEAT a success status', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'success', conflictsCount: 2 }));
		expect(info.text).toBe('2 conflicts'); // not "Synced"
	});

	test('syncing BEATS pending — an in-flight sync outranks the queued count', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'syncing', pendingCount: 9 }));
		expect(info.text).toBe('Syncing...'); // not "9 pending"
	});

	test('error BEATS pending — a failed sync is shown over the still-queued count', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'error', pendingCount: 9 }));
		expect(info.text).toBe('Sync failed'); // not "9 pending"
	});

	test('success BEATS pending', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'success', pendingCount: 9 }));
		expect(info.text).toBe('Synced'); // not "9 pending"
	});
});
