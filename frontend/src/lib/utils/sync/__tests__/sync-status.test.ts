import { describe, expect, test } from 'vitest';
import { Wifi, WifiOff, RefreshCw, CircleCheck, CircleAlert, Clock } from '@lucide/svelte';
import { getSyncStatusInfo, type SyncStatusParams } from '$lib/utils/sync/sync-status';

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
		expect(info.text).toBe('Offline');
	});

	test('conflicts BEAT syncing — an unresolved conflict is not hidden behind the sync spinner', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'syncing', conflictsCount: 1 }));
		expect(info.text).toBe('1 conflict');
	});

	test('conflicts BEAT a success status', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'success', conflictsCount: 2 }));
		expect(info.text).toBe('2 conflicts');
	});

	test('syncing BEATS pending — an in-flight sync outranks the queued count', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'syncing', pendingCount: 9 }));
		expect(info.text).toBe('Syncing...');
	});

	test('error BEATS pending — a failed sync is shown over the still-queued count', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'error', pendingCount: 9 }));
		expect(info.text).toBe('Sync failed');
	});

	test('success BEATS pending', () => {
		const info = getSyncStatusInfo(params({ syncStatus: 'success', pendingCount: 9 }));
		expect(info.text).toBe('Synced');
	});
});
