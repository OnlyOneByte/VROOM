import { describe, expect, test } from 'vitest';
import { ServerOff, WifiOff } from '@lucide/svelte';
import { getSyncStatusInfo, type SyncStatusParams } from '#lib/utils/sync/sync-status.ts';

function params(overrides: Partial<SyncStatusParams> = {}): SyncStatusParams {
	return {
		isOnline: true,
		syncStatus: 'idle',
		pendingCount: 0,
		conflictsCount: 0,
		serverReachable: true,
		...overrides
	};
}

describe('getSyncStatusInfo — server unreachable', () => {
	test('an unreachable server is never shown as online', () => {
		const info = getSyncStatusInfo(params({ serverReachable: false }));
		expect(info.icon).toBe(ServerOff);
		expect(info.color).toBe('text-warning');
		expect(info.text).toBe("Can't reach VROOM");
	});

	test('it outranks pending entries, conflicts and a stale sync result', () => {
		for (const overrides of [
			{ pendingCount: 3 },
			{ conflictsCount: 1 },
			{ syncStatus: 'success' as const },
			{ syncStatus: 'error' as const }
		]) {
			expect(getSyncStatusInfo(params({ ...overrides, serverReachable: false })).icon).toBe(
				ServerOff
			);
		}
	});

	test('being offline still wins, since that is the cause', () => {
		expect(getSyncStatusInfo(params({ isOnline: false, serverReachable: false })).icon).toBe(
			WifiOff
		);
	});
});
