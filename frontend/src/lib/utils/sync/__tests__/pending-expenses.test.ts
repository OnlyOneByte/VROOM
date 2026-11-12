import { describe, expect, it, beforeEach } from 'vitest';
import {
	countParked,
	countPendingSync,
	isParked,
	isPendingSync
} from '#lib/utils/sync/pending-expenses.ts';
import { getNeedsAttentionExpenses, getPendingExpenses } from '#lib/utils/offline-storage.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

const OFFLINE_STORAGE_KEY = 'vroom_offline_expenses';

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

const PENDING = row({ id: 'pending' });
const PARKED = row({ id: 'parked', needsAttention: true, attentionReason: 'server said no' });
const SYNCED = row({ id: 'synced', synced: true });
const SYNCED_AND_FLAGGED = row({ id: 'synced-flagged', synced: true, needsAttention: true });

const ALL = [PENDING, PARKED, SYNCED, SYNCED_AND_FLAGGED];

describe('pending-sync predicate', () => {
	it('a parked row is not pending', () => {
		expect(isPendingSync(PARKED)).toBe(false);
		expect(isParked(PARKED)).toBe(true);
	});

	it('an unsynced, unparked row is pending', () => {
		expect(isPendingSync(PENDING)).toBe(true);
		expect(isParked(PENDING)).toBe(false);
	});

	it('a synced row is neither pending nor parked, even if the flag was left behind', () => {
		expect(isPendingSync(SYNCED)).toBe(false);
		expect(isParked(SYNCED)).toBe(false);
		expect(isPendingSync(SYNCED_AND_FLAGGED)).toBe(false);
		expect(isParked(SYNCED_AND_FLAGGED)).toBe(false);
	});

	it('counts the two states separately over a mixed queue', () => {
		expect(countPendingSync(ALL)).toBe(1);
		expect(countParked(ALL)).toBe(1);
	});

	it('an empty queue counts zero of each', () => {
		expect(countPendingSync([])).toBe(0);
		expect(countParked([])).toBe(0);
	});
});

describe('parity with the persisted-outbox readers', () => {
	beforeEach(() => {
		localStorage.setItem(OFFLINE_STORAGE_KEY, JSON.stringify(ALL));
	});

	it('countPendingSync matches getPendingExpenses over the same rows', () => {
		expect(countPendingSync(ALL)).toBe(getPendingExpenses().length);
		expect(getPendingExpenses().map(e => e.id)).toEqual(ALL.filter(isPendingSync).map(e => e.id));
	});

	it('countParked matches getNeedsAttentionExpenses over the same rows', () => {
		expect(countParked(ALL)).toBe(getNeedsAttentionExpenses().length);
		expect(getNeedsAttentionExpenses().map(e => e.id)).toEqual(ALL.filter(isParked).map(e => e.id));
	});
});
