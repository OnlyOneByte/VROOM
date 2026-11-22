import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	addOfflineExpense,
	loadOfflineExpenses,
	saveOfflineExpenses,
	removeOfflineExpense,
	getPendingExpenses,
	getNeedsAttentionExpenses,
	markExpenseNeedsAttention,
	clearNeedsAttention,
	isIncompleteFuelExpense,
	markExpenseAsSynced,
	clearSyncedExpenses,
	offlineExpenseToBackend,
	savePendingPhotos,
	loadPendingPhotos,
	deletePendingPhotos,
	setOfflineQueueOwner,
	currentOfflineQueueOwner,
	cacheVehicles,
	cacheVehicleHistory,
	loadCachedVehicles,
	loadCachedVehicleHistory,
	updateCachedVehicle,
	removeCachedVehicle,
	findParkedExpense,
	replaceParkedExpense,
	type OfflineExpense
} from '../offline-storage';
import type { Vehicle } from '#lib/types/index.ts';
import { offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';

const localStorageMock = window.localStorage as any;

describe('Offline Storage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.getItem.mockReturnValue(null);
	});

	describe('loadOfflineExpenses', () => {
		it('should return empty array when no data exists', () => {
			const expenses = loadOfflineExpenses();
			expect(expenses).toEqual([]);
		});

		it('should return parsed expenses from localStorage', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			const expenses = loadOfflineExpenses();
			expect(expenses).toHaveLength(1);
			const migrated = expenses[0];
			if (!migrated) throw new Error('expected one migrated expense');
			expect(migrated).toMatchObject({ ...mockExpenses[0], version: '3.0' });
			expect(typeof migrated.clientId).toBe('string');
			expect((migrated.clientId ?? '').length).toBeGreaterThan(0);
		});

		it('should handle corrupted localStorage data gracefully', () => {
			localStorageMock.getItem.mockReturnValue('invalid json');

			const expenses = loadOfflineExpenses();
			expect(expenses).toEqual([]);
		});

		it('backfills a legacy clientId deterministically, stable across repeated reads', () => {
			const legacy: OfflineExpense[] = [
				{
					id: 'legacy-entry-1',
					vehicleId: 'vehicle-1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 42.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			];
			localStorageMock.getItem.mockReturnValue(JSON.stringify(legacy));

			const first = loadOfflineExpenses()[0];
			const second = loadOfflineExpenses()[0];

			expect(first?.clientId).toBeTruthy();
			expect(second?.clientId).toBe(first?.clientId);
			expect(second?.version).toBe('3.0');
		});

		it('preserves an existing clientId on migration (never re-mints over a real key)', () => {
			const withKey: OfflineExpense[] = [
				{
					id: 'legacy-entry-2',
					clientId: 'already-assigned-key',
					vehicleId: 'vehicle-1',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 99.0,
					date: '2024-02-01',
					timestamp: Date.now(),
					synced: false
				}
			];
			localStorageMock.getItem.mockReturnValue(JSON.stringify(withKey));

			const migrated = loadOfflineExpenses()[0];
			expect(migrated?.clientId).toBe('already-assigned-key');
			expect(migrated?.version).toBe('3.0');
		});
	});

	describe('saveOfflineExpenses', () => {
		it('should save expenses to localStorage', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'test-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				}
			];

			saveOfflineExpenses(mockExpenses);

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'vroom_offline_expenses',
				JSON.stringify(mockExpenses)
			);
		});
	});

	describe('a storage write that fails is reported, never swallowed', () => {
		const row: OfflineExpense = {
			id: 'test-1',
			vehicleId: 'vehicle-1',
			tags: ['fuel'],
			category: 'fuel',
			amount: 50.0,
			date: '2024-01-01',
			timestamp: Date.now(),
			synced: false
		};

		function blockNextWrite(error: Error): void {
			localStorageMock.setItem.mockImplementationOnce(() => {
				throw error;
			});
		}

		it('saveOfflineExpenses returns false when setItem throws', () => {
			blockNextWrite(new DOMException('exceeded the quota', 'QuotaExceededError'));

			expect(saveOfflineExpenses([row])).toBe(false);
		});

		it('saveOfflineExpenses returns true when the write lands', () => {
			expect(saveOfflineExpenses([row])).toBe(true);
		});

		it('addOfflineExpense propagates the failure to its caller (the save-offline toast depends on it)', async () => {
			blockNextWrite(new DOMException('site data is blocked', 'SecurityError'));

			const queued = await addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			});

			expect(queued).toBe(false);
		});

		it('addOfflineExpense returns true on a successful queue', async () => {
			const queued = await addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			});

			expect(queued).toBe(true);
		});

		it('addOfflineExpense refuses to queue when its photos cannot be stored, instead of dropping them', async () => {
			vi.stubGlobal('indexedDB', undefined);
			try {
				const queued = await addOfflineExpense(
					{ vehicleId: 'vehicle-1', tags: [], category: 'misc', amount: 9, date: '2024-01-01' },
					[new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' })]
				);

				expect(queued).toBe(false);
				expect(localStorageMock.setItem).not.toHaveBeenCalled();
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('the in-memory queue is NOT mirrored when the write failed (no phantom pending row)', () => {
			offlineExpenseQueue.current = [];
			blockNextWrite(new DOMException('exceeded the quota', 'QuotaExceededError'));

			saveOfflineExpenses([row]);

			expect(offlineExpenseQueue.current).toEqual([]);
		});
	});

	describe('corrupted outbox blob', () => {
		it('is stashed under a sibling key before the next write can overwrite it', () => {
			localStorageMock.getItem.mockReturnValue('{not json');

			expect(loadOfflineExpenses()).toEqual([]);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'vroom_offline_expenses.corrupt',
				'{not json'
			);
		});
	});

	describe('amounts are kept to whole cents', () => {
		it('a new entry is queued rounded to 2 decimals', async () => {
			await addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: [],
				category: 'misc',
				amount: 12.345,
				date: '2024-01-01'
			});

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData[0].amount).toBe(12.35);
		});

		it('entries queued before rounding load rounded the way the server rounds, so they still sync', () => {
			const queued = (id: string, amount: number, version?: string) => ({
				id,
				clientId: id,
				vehicleId: 'vehicle-1',
				tags: [],
				category: 'misc',
				amount,
				date: '2024-01-01',
				timestamp: 1,
				synced: false,
				version
			});
			localStorageMock.getItem.mockReturnValue(
				JSON.stringify([
					queued('current', 25.678, '3.0'),
					queued('legacy', 1234.561),
					queued('tie', 1.005, '3.0')
				])
			);

			expect(loadOfflineExpenses().map(expense => expense.amount)).toEqual([
				25.68,
				1234.56,
				Math.round(1.005 * 100) / 100
			]);
		});
	});

	describe('addOfflineExpense', () => {
		it('should add new expense with generated ID and timestamp', async () => {
			const expenseData = {
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			};

			await addOfflineExpense(expenseData);

			expect(localStorageMock.setItem).toHaveBeenCalled();
			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);

			expect(savedData).toHaveLength(1);
			expect(savedData[0]).toMatchObject({
				...expenseData,
				synced: false
			});
			expect(savedData[0].id).toMatch(/^offline_\d+_[a-z0-9]+$/);
			expect(savedData[0].timestamp).toBeTypeOf('number');
		});

		it('persists fuelType into the outbox so an electric charge survives sync', async () => {
			await addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 30.0,
				date: '2024-03-01',
				charge: 42,
				fuelType: 'Electric'
			});

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData[0].fuelType).toBe('Electric');
			expect(savedData[0].charge).toBe(42);
		});

		it('should append to existing expenses', async () => {
			const existingExpenses: OfflineExpense[] = [
				{
					id: 'existing-1',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-01',
					timestamp: Date.now() - 1000,
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(existingExpenses));

			const newExpenseData = {
				vehicleId: 'vehicle-2',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-02'
			};

			await addOfflineExpense(newExpenseData);

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(2);
			expect(savedData[0]).toMatchObject({ ...existingExpenses[0], version: '3.0' });
			expect(typeof savedData[0].clientId).toBe('string');
			expect(savedData[1]).toMatchObject(newExpenseData);
			expect(typeof savedData[1].clientId).toBe('string');
		});
	});

	describe('getPendingExpenses', () => {
		it('should return only unsynced expenses', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'synced-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: true
				},
				{
					id: 'pending-1',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			const pending = getPendingExpenses();
			expect(pending).toHaveLength(1);
			expect(pending[0]?.id).toBe('pending-1');
		});
	});

	describe('needs-attention parking', () => {
		const rows: OfflineExpense[] = [
			{
				id: 'ok-1',
				vehicleId: 'v1',
				tags: ['maintenance'],
				category: 'maintenance',
				amount: 100,
				date: '2024-01-02',
				timestamp: Date.now(),
				synced: false
			},
			{
				id: 'malformed-1',
				vehicleId: 'v1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50,
				date: '2024-01-01',
				timestamp: Date.now(),
				synced: false,
				needsAttention: true
			}
		];

		it('getPendingExpenses EXCLUDES a needs-attention row (no infinite silent re-attempt)', () => {
			localStorageMock.getItem.mockReturnValue(JSON.stringify(rows));
			const pending = getPendingExpenses();
			expect(pending.map(e => e.id)).toEqual(['ok-1']);
		});

		it('getNeedsAttentionExpenses surfaces ONLY the parked (unsynced + flagged) rows', () => {
			localStorageMock.getItem.mockReturnValue(JSON.stringify(rows));
			const parked = getNeedsAttentionExpenses();
			expect(parked.map(e => e.id)).toEqual(['malformed-1']);
		});

		it('a SYNCED row is never surfaced as needs-attention (synced wins)', () => {
			localStorageMock.getItem.mockReturnValue(
				JSON.stringify([{ ...rows[1], synced: true, needsAttention: true }])
			);
			expect(getNeedsAttentionExpenses()).toHaveLength(0);
		});

		it('markExpenseNeedsAttention flags the target row only; clearNeedsAttention re-admits it to pending', () => {
			localStorageMock.getItem.mockReturnValue(
				JSON.stringify([{ ...rows[0] }, { ...rows[1], needsAttention: false }])
			);
			markExpenseNeedsAttention('malformed-1');
			let saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]);
			expect(saved.find((e: OfflineExpense) => e.id === 'malformed-1').needsAttention).toBe(true);
			expect(saved.find((e: OfflineExpense) => e.id === 'ok-1').needsAttention).toBeFalsy();

			localStorageMock.getItem.mockReturnValue(JSON.stringify(saved));
			clearNeedsAttention('malformed-1');
			saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]);
			expect(saved.find((e: OfflineExpense) => e.id === 'malformed-1').needsAttention).toBe(false);
		});

		it('stores the reason with the parked row, and drops it when the row is re-admitted', () => {
			localStorageMock.getItem.mockReturnValue(
				JSON.stringify([{ ...rows[1], needsAttention: false }])
			);

			markExpenseNeedsAttention('malformed-1', 'Vehicle not found');
			let saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]);
			expect(saved[0].attentionReason).toBe('Vehicle not found');

			localStorageMock.getItem.mockReturnValue(JSON.stringify(saved));
			clearNeedsAttention('malformed-1');
			saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]);
			expect(saved[0].attentionReason).toBeUndefined();
		});

		it('the Needs-attention card names the fields the parking gate checks (volume/charge + mileage, not bare amount)', () => {
			const src = readFileSync(
				`${process.cwd()}/src/lib/components/expenses/OfflineExpenseCards.svelte`,
				'utf8'
			);
			const start = src.indexOf('Needs attention ({needsAttentionExpenses.length})');
			expect(start, 'the Needs-attention section exists').toBeGreaterThan(-1);
			const descSlice = src.slice(start, start + 400);
			expect(descSlice).toMatch(/volume/i);
			expect(descSlice).toMatch(/charge/i);
			expect(descSlice).toMatch(/mileage/i);
			expect(descSlice).not.toMatch(/needs its amount and mileage/i);
		});
	});

	describe('markExpenseAsSynced', () => {
		it('should mark specific expense as synced', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'expense-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				},
				{
					id: 'expense-2',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			markExpenseAsSynced('expense-1');

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData[0].synced).toBe(true);
			expect(savedData[1].synced).toBe(false);
		});
	});

	describe('clearSyncedExpenses', () => {
		it('should remove synced expenses and keep pending ones', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'synced-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: true
				},
				{
					id: 'pending-1',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			clearSyncedExpenses();

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(1);
			expect(savedData[0].id).toBe('pending-1');
		});

		it('KEEPS a parked (needsAttention) row — only synced rows are cleared (data-safety)', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'synced-1',
					vehicleId: 'v1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: true
				},
				{
					id: 'parked-1',
					vehicleId: 'v1',
					tags: ['fuel'],
					category: 'fuel',
					amount: 60,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false,
					needsAttention: true
				},
				{
					id: 'pending-1',
					vehicleId: 'v1',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100,
					date: '2024-01-03',
					timestamp: Date.now(),
					synced: false
				}
			];
			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			clearSyncedExpenses();

			const saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]) as OfflineExpense[];
			expect(saved.map(e => e.id).sort()).toEqual(['parked-1', 'pending-1']);
		});
	});

	describe('removeOfflineExpense', () => {
		it('should remove specific expense by ID', () => {
			const mockExpenses: OfflineExpense[] = [
				{
					id: 'expense-1',
					vehicleId: 'vehicle-1',
					type: 'fuel',
					tags: ['fuel'],
					category: 'fuel',
					amount: 50.0,
					date: '2024-01-01',
					timestamp: Date.now(),
					synced: false
				},
				{
					id: 'expense-2',
					vehicleId: 'vehicle-1',
					type: 'maintenance',
					tags: ['maintenance'],
					category: 'maintenance',
					amount: 100.0,
					date: '2024-01-02',
					timestamp: Date.now(),
					synced: false
				}
			];

			localStorageMock.getItem.mockReturnValue(JSON.stringify(mockExpenses));

			removeOfflineExpense('expense-1');

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toHaveLength(1);
			expect(savedData[0].id).toBe('expense-2');
		});
	});
});

describe('offlineExpenseToBackend — shared offline→backend mapping', () => {
	const base: OfflineExpense = {
		id: 'off-1',
		vehicleId: 'vehicle-1',
		tags: ['fuel'],
		category: 'fuel',
		amount: 42.5,
		date: '2024-03-01',
		mileage: 12000,
		timestamp: 1700000000000,
		synced: false
	};

	it('maps the core fields (amount→expenseAmount, vehicleId, category, date, mileage, tags)', () => {
		const out = offlineExpenseToBackend(base);
		expect(out.expenseAmount).toBe(42.5);
		expect(out.vehicleId).toBe('vehicle-1');
		expect(out.category).toBe('fuel');
		expect(out.date).toBe('2024-03-01');
		expect(out.mileage).toBe(12000);
		expect(out.tags).toEqual(['fuel']);
	});

	it('carries an electric charge through', () => {
		const out = offlineExpenseToBackend({ ...base, charge: 55, fuelType: 'Electric' });
		expect(out.volume).toBe(55);
		expect(out.fuelType).toBe('Electric');
	});

	it('keeps a liquid-fuel volume on the volume field', () => {
		const out = offlineExpenseToBackend({ ...base, volume: 40, fuelType: 'Diesel' });
		expect(out.volume).toBe(40);
		expect(out.fuelType).toBe('Diesel');
	});

	it('carries missedFillup through (the invariant — same dropout class as)', () => {
		const trueOut = offlineExpenseToBackend({
			...base,
			volume: 40,
			fuelType: 'Diesel',
			missedFillup: true
		});
		expect(trueOut.missedFillup).toBe(true);
		const falseOut = offlineExpenseToBackend({
			...base,
			volume: 40,
			fuelType: 'Diesel',
			missedFillup: false
		});
		expect(falseOut.missedFillup).toBe(false);
	});

	it('carries EVERY user-settable field together (the dropout-class completeness pin)', () => {
		const full: OfflineExpense = {
			id: 'off-full',
			clientId: 'cid-full',
			vehicleId: 'vehicle-9',
			tags: ['fuel', 'road-trip'],
			category: 'fuel',
			amount: 73.21,
			date: '2024-07-04',
			mileage: 54321,
			volume: 12.5,
			fuelType: 'Diesel',
			missedFillup: true,
			description: 'Costco top-up',
			timestamp: 1700000000000,
			synced: false
		};
		const out = offlineExpenseToBackend(full);
		expect(out.vehicleId).toBe('vehicle-9');
		expect(out.tags).toEqual(['fuel', 'road-trip']);
		expect(out.category).toBe('fuel');
		expect(out.expenseAmount).toBe(73.21);
		expect(out.date).toBe('2024-07-04');
		expect(out.mileage).toBe(54321);
		expect(out.volume).toBe(12.5);
		expect(out.fuelType).toBe('Diesel');
		expect(out.missedFillup).toBe(true);
		expect(out.description).toBe('Costco top-up');
	});
});

describe('isIncompleteFuelExpense', () => {
	function fuel(over: Partial<OfflineExpense>): OfflineExpense {
		return {
			id: 'e1',
			vehicleId: 'v1',
			tags: ['fuel'],
			category: 'fuel',
			amount: 50,
			date: '2024-01-01',
			timestamp: 0,
			synced: false,
			...over
		};
	}

	it('a non-fuel expense is NEVER incomplete (the category gate), even with no volume/mileage', () => {
		expect(
			isIncompleteFuelExpense(
				fuel({ category: 'maintenance', volume: undefined, mileage: undefined })
			)
		).toBe(false);
	});

	it('a fuel expense missing BOTH volume and charge is incomplete', () => {
		expect(
			isIncompleteFuelExpense(fuel({ volume: undefined, charge: undefined, mileage: 30000 }))
		).toBe(true);
	});

	it('a fuel expense missing mileage is incomplete (even with volume present)', () => {
		expect(isIncompleteFuelExpense(fuel({ volume: 10, mileage: undefined }))).toBe(true);
	});

	it('a complete liquid-fuel expense (volume + mileage) is NOT incomplete', () => {
		expect(isIncompleteFuelExpense(fuel({ volume: 10, mileage: 30000 }))).toBe(false);
	});

	it('a complete ELECTRIC expense (charge satisfies the volume-or-charge requirement) is NOT incomplete', () => {
		expect(isIncompleteFuelExpense(fuel({ volume: undefined, charge: 25, mileage: 30000 }))).toBe(
			false
		);
	});
});

type PhotoDbFailure = 'none' | 'open' | 'abort';

function fakePhotoDb(failure: { mode: PhotoDbFailure } = { mode: 'none' }) {
	const photos = new Map<unknown, unknown>();
	let created = false;
	const database = {
		createObjectStore: () => {
			created = true;
		},
		transaction: () => {
			const transaction: {
				error: DOMException | null;
				oncomplete?: () => void;
				onabort?: () => void;
				objectStore: () => unknown;
			} = {
				error: null,
				objectStore: () => ({
					put: (value: unknown, key: unknown) => (photos.set(key, value), { result: key }),
					get: (key: unknown) => ({ result: photos.get(key) }),
					delete: (key: unknown) => (photos.delete(key), { result: undefined })
				})
			};
			queueMicrotask(() => {
				if (failure.mode === 'abort') {
					transaction.error = new DOMException('quota', 'QuotaExceededError');
					transaction.onabort?.();
				} else {
					transaction.oncomplete?.();
				}
			});
			return transaction;
		},
		close: vi.fn()
	};
	const factory = {
		photos,
		database,
		open: () => {
			const request: {
				result?: unknown;
				error?: DOMException;
				onupgradeneeded?: () => void;
				onsuccess?: () => void;
				onerror?: () => void;
			} = {};
			queueMicrotask(() => {
				if (failure.mode === 'open') {
					request.error = new DOMException('blocked', 'SecurityError');
					request.onerror?.();
					return;
				}
				request.result = database;
				if (!created) request.onupgradeneeded?.();
				request.onsuccess?.();
			});
			return request;
		}
	};
	return factory;
}

const photo = () => new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' });

const queuedRow = (overrides: Partial<OfflineExpense> = {}): OfflineExpense => ({
	id: 'row-1',
	clientId: 'cid-1',
	vehicleId: 'vehicle-1',
	tags: [],
	category: 'misc',
	amount: 12,
	date: '2024-01-01',
	timestamp: 0,
	synced: false,
	version: '3.0',
	...overrides
});

describe('pending photo store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.getItem.mockReturnValue(null);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('round-trips photos saved under a client id', async () => {
		const db = fakePhotoDb();
		vi.stubGlobal('indexedDB', db);
		const files = [photo()];

		expect(await savePendingPhotos('cid-1', files)).toBe(true);
		expect(await loadPendingPhotos('cid-1')).toEqual(files);
		expect(db.database.close).toHaveBeenCalled();
	});

	it('loads an empty list for an unknown client id', async () => {
		vi.stubGlobal('indexedDB', fakePhotoDb());
		expect(await loadPendingPhotos('missing')).toEqual([]);
	});

	it('loads an empty list when the stored value is not a photo list', async () => {
		const db = fakePhotoDb();
		db.photos.set('cid-odd', 'not-an-array');
		vi.stubGlobal('indexedDB', db);
		expect(await loadPendingPhotos('cid-odd')).toEqual([]);
	});

	it('loads an empty list and deletes nothing when IndexedDB is unavailable', async () => {
		vi.stubGlobal('indexedDB', undefined);
		expect(await loadPendingPhotos('cid-1')).toEqual([]);
		await expect(deletePendingPhotos('cid-1')).resolves.toBeUndefined();
	});

	it('saving an empty photo list clears photos previously stored for that client', async () => {
		const db = fakePhotoDb();
		db.photos.set('cid-1', [photo()]);
		vi.stubGlobal('indexedDB', db);

		expect(await savePendingPhotos('cid-1', [])).toBe(true);
		expect(db.photos.has('cid-1')).toBe(false);
	});

	it('saving an empty photo list succeeds even when IndexedDB is unavailable', async () => {
		vi.stubGlobal('indexedDB', undefined);
		expect(await savePendingPhotos('cid-1', [])).toBe(true);
	});

	it('reports failure when the photo database cannot be opened', async () => {
		vi.stubGlobal('indexedDB', fakePhotoDb({ mode: 'open' }));
		expect(await savePendingPhotos('cid-1', [photo()])).toBe(false);
	});

	it('reports failure when the photo write transaction aborts', async () => {
		const db = fakePhotoDb({ mode: 'abort' });
		vi.stubGlobal('indexedDB', db);
		expect(await savePendingPhotos('cid-1', [photo()])).toBe(false);
		expect(db.database.close).toHaveBeenCalled();
	});

	it('addOfflineExpense removes the photos it stored when the queue write then fails', async () => {
		const db = fakePhotoDb();
		vi.stubGlobal('indexedDB', db);
		localStorageMock.setItem.mockImplementationOnce(() => {
			throw new DOMException('exceeded the quota', 'QuotaExceededError');
		});

		const queued = await addOfflineExpense(
			{ vehicleId: 'vehicle-1', tags: [], category: 'misc', amount: 9, date: '2024-01-01' },
			[photo()],
			'cid-rollback'
		);

		expect(queued).toBe(false);
		expect(db.photos.has('cid-rollback')).toBe(false);
	});

	it('addOfflineExpense keeps its photos when the queue write lands', async () => {
		const db = fakePhotoDb();
		vi.stubGlobal('indexedDB', db);

		const queued = await addOfflineExpense(
			{ vehicleId: 'vehicle-1', tags: [], category: 'misc', amount: 9, date: '2024-01-01' },
			[photo()],
			'cid-kept'
		);

		expect(queued).toBe(true);
		expect(db.photos.get('cid-kept')).toHaveLength(1);
	});

	it('removeOfflineExpense deletes the removed row photos', async () => {
		const db = fakePhotoDb();
		db.photos.set('cid-1', [photo()]);
		vi.stubGlobal('indexedDB', db);
		localStorageMock.getItem.mockReturnValue(JSON.stringify([queuedRow()]));

		removeOfflineExpense('row-1');

		await vi.waitFor(() => expect(db.photos.has('cid-1')).toBe(false));
	});

	it('removeOfflineExpense keeps photos when the queue write fails', async () => {
		const db = fakePhotoDb();
		db.photos.set('cid-1', [photo()]);
		const open = vi.spyOn(db, 'open');
		vi.stubGlobal('indexedDB', db);
		localStorageMock.getItem.mockReturnValue(JSON.stringify([queuedRow()]));
		localStorageMock.setItem.mockImplementationOnce(() => {
			throw new DOMException('site data is blocked', 'SecurityError');
		});

		removeOfflineExpense('row-1');

		expect(open).not.toHaveBeenCalled();
		expect(db.photos.has('cid-1')).toBe(true);
	});

	it('removeOfflineExpense of an unknown id leaves the photo store untouched', () => {
		const db = fakePhotoDb();
		const open = vi.spyOn(db, 'open');
		vi.stubGlobal('indexedDB', db);
		localStorageMock.getItem.mockReturnValue(JSON.stringify([queuedRow()]));

		removeOfflineExpense('row-unknown');

		expect(open).not.toHaveBeenCalled();
		const saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]) as OfflineExpense[];
		expect(saved.map(e => e.id)).toEqual(['row-1']);
	});
});

describe('unreadable outbox', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		localStorageMock.getItem.mockReset();
		localStorageMock.getItem.mockReturnValue(null);
		vi.restoreAllMocks();
	});

	it('a storage security error on read yields an empty queue and stashes nothing', () => {
		localStorageMock.getItem.mockImplementation(() => {
			throw new DOMException('site data is blocked', 'SecurityError');
		});

		expect(loadOfflineExpenses()).toEqual([]);
		expect(localStorageMock.setItem).not.toHaveBeenCalled();
	});

	it('a read error with nothing left to stash writes no corrupt copy', () => {
		localStorageMock.getItem
			.mockImplementationOnce(() => {
				throw new DOMException('site data is blocked', 'SecurityError');
			})
			.mockImplementationOnce(() => null);

		expect(loadOfflineExpenses()).toEqual([]);
		expect(localStorageMock.setItem).not.toHaveBeenCalled();
	});

	it('a stored value that is valid JSON but not a list yields an empty queue', () => {
		localStorageMock.getItem.mockReturnValue(JSON.stringify({ id: 'not-a-list' }));

		expect(loadOfflineExpenses()).toEqual([]);
		expect(localStorageMock.setItem).toHaveBeenCalledWith(
			'vroom_offline_expenses.corrupt',
			JSON.stringify({ id: 'not-a-list' })
		);
	});
});

describe('offlineExpenseToBackend for an edit replay', () => {
	const sparse: OfflineExpense = {
		id: 'off-edit',
		vehicleId: 'vehicle-1',
		tags: [],
		category: 'misc',
		amount: 10,
		date: '2024-03-01',
		timestamp: 0,
		synced: false
	};

	it('clears emptied optional fields and defaults missedFillup to false', () => {
		const out = offlineExpenseToBackend(sparse, { clearEmptyFields: true });
		expect(out.description).toBeNull();
		expect(out.location).toBeNull();
		expect(out.fuelType).toBeNull();
		expect(out.missedFillup).toBe(false);
	});

	it('keeps an explicit missedFillup on an edit replay', () => {
		const out = offlineExpenseToBackend(
			{ ...sparse, missedFillup: true },
			{ clearEmptyFields: true }
		);
		expect(out.missedFillup).toBe(true);
	});

	it('a create replay omits emptied optional fields instead of clearing them', () => {
		const out = offlineExpenseToBackend(sparse);
		expect(out).not.toHaveProperty('description');
		expect(out).not.toHaveProperty('missedFillup');
	});
});

describe('markExpenseNeedsAttention server id', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		localStorageMock.getItem.mockReturnValue(null);
	});

	it('records the server id of a row that reached the server before parking', () => {
		localStorageMock.getItem.mockReturnValue(JSON.stringify([queuedRow()]));

		markExpenseNeedsAttention('row-1', 'conflict', 'server-9');

		const saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]) as OfflineExpense[];
		expect(saved[0]).toMatchObject({
			needsAttention: true,
			attentionReason: 'conflict',
			serverId: 'server-9'
		});
	});

	it('leaves the reason and server id unset when neither is given', () => {
		localStorageMock.getItem.mockReturnValue(JSON.stringify([queuedRow()]));

		markExpenseNeedsAttention('row-1');

		const saved = JSON.parse(localStorageMock.setItem.mock.calls.at(-1)[1]) as OfflineExpense[];
		expect(saved[0]?.needsAttention).toBe(true);
		expect(saved[0]).not.toHaveProperty('attentionReason');
		expect(saved[0]).not.toHaveProperty('serverId');
	});
});

describe('queue owner scoping', () => {
	const UNSCOPED = 'vroom_offline_expenses';
	const scoped = (owner: string) => `${UNSCOPED}:${owner}`;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		setOfflineQueueOwner(null);
		localStorageMock.getItem.mockReset();
		localStorageMock.setItem.mockReset();
		localStorageMock.removeItem.mockReset();
		localStorageMock.getItem.mockReturnValue(null);
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function useStore(entries: Record<string, string>) {
		const store = new Map(Object.entries(entries));
		localStorageMock.getItem.mockImplementation((key: string) => store.get(key) ?? null);
		localStorageMock.setItem.mockImplementation((key: string, value: string) => {
			store.set(key, value);
		});
		localStorageMock.removeItem.mockImplementation((key: string) => {
			store.delete(key);
		});
		return store;
	}

	it('signing in adopts the unscoped queue into the owner key, skipping ids it already has', () => {
		const store = useStore({
			[UNSCOPED]: JSON.stringify([queuedRow({ id: 'shared' }), queuedRow({ id: 'guest-only' })]),
			[scoped('user-1')]: JSON.stringify([queuedRow({ id: 'shared', amount: 99 })])
		});

		setOfflineQueueOwner('user-1');

		expect(currentOfflineQueueOwner()).toBe('user-1');
		expect(store.has(UNSCOPED)).toBe(false);
		const owned = JSON.parse(store.get(scoped('user-1'))!) as OfflineExpense[];
		expect(owned.map(e => [e.id, e.amount])).toEqual([
			['shared', 99],
			['guest-only', 12]
		]);
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['shared', 'guest-only']);
	});

	it('signing in with no unscoped queue writes nothing', () => {
		useStore({ [scoped('user-2')]: JSON.stringify([queuedRow({ id: 'mine' })]) });

		setOfflineQueueOwner('user-2');

		expect(localStorageMock.setItem).not.toHaveBeenCalled();
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['mine']);
	});

	it('a corrupt unscoped queue is left in place rather than adopted', () => {
		const store = useStore({ [UNSCOPED]: '{broken' });

		setOfflineQueueOwner('user-3');

		expect(store.get(UNSCOPED)).toBe('{broken');
		expect(store.has(scoped('user-3'))).toBe(false);
		expect(offlineExpenseQueue.current).toEqual([]);
	});

	it('setting the same owner again does not reload or re-adopt', () => {
		useStore({});
		setOfflineQueueOwner('user-4');
		localStorageMock.getItem.mockClear();

		setOfflineQueueOwner('user-4');

		expect(localStorageMock.getItem).not.toHaveBeenCalled();
	});

	it('signing out switches back to the unscoped queue without adopting', () => {
		useStore({
			[scoped('user-5')]: JSON.stringify([queuedRow({ id: 'owned' })]),
			[UNSCOPED]: JSON.stringify([queuedRow({ id: 'guest' })])
		});
		setOfflineQueueOwner('user-5');
		useStore({ [UNSCOPED]: JSON.stringify([queuedRow({ id: 'guest-after' })]) });

		setOfflineQueueOwner(null);

		expect(currentOfflineQueueOwner()).toBeNull();
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['guest-after']);
	});

	it('saving another owner queue writes its key without touching the in-memory queue', () => {
		const store = useStore({});
		setOfflineQueueOwner('user-6');
		offlineExpenseQueue.current = [];

		expect(saveOfflineExpenses([queuedRow({ id: 'other' })], 'user-7')).toBe(true);

		expect(JSON.parse(store.get(scoped('user-7'))!)).toHaveLength(1);
		expect(offlineExpenseQueue.current).toEqual([]);
	});

	const vehicle = (id: string, nickname: string) =>
		({ id, nickname, initialMileage: 1000 }) as unknown as Vehicle;

	it('an edited vehicle replaces its cached copy, keeping fields the save response leaves out', () => {
		useStore({});
		setOfflineQueueOwner('user-8');
		cacheVehicles(
			[
				{ ...vehicle('v1', 'Old'), financing: { id: 'f1' } } as unknown as Vehicle,
				vehicle('v2', 'Other')
			],
			'user-8'
		);

		updateCachedVehicle(vehicle('v1', 'New'), 'user-8');

		const cached = loadCachedVehicles();
		expect(cached.map(v => [v.id, v.nickname])).toEqual([
			['v1', 'New'],
			['v2', 'Other']
		]);
		expect(cached[0]?.financing).toEqual({ id: 'f1' });
	});

	it('an edited vehicle that was never cached is not added', () => {
		useStore({});
		setOfflineQueueOwner('user-9');
		cacheVehicles([vehicle('v1', 'Mine')], 'user-9');

		updateCachedVehicle(vehicle('shared', 'Theirs'), 'user-9');

		expect(loadCachedVehicles().map(v => v.id)).toEqual(['v1']);
	});

	it('a cache write requested for one account is dropped once another account is signed in', () => {
		const store = useStore({});
		setOfflineQueueOwner('user-a');
		cacheVehicles([vehicle('v1', 'Mine')], 'user-a');
		setOfflineQueueOwner('user-b');

		cacheVehicles([vehicle('v1', 'Theirs')], 'user-b');
		cacheVehicles([vehicle('v1', 'Late')], 'user-a');
		cacheVehicleHistory('v1', [], 'user-a');
		updateCachedVehicle(vehicle('v1', 'Late edit'), 'user-a');
		removeCachedVehicle('v1', 'user-a');

		expect(loadCachedVehicles().map(v => v.nickname)).toEqual(['Theirs']);
		expect(loadCachedVehicleHistory('v1')).toBeNull();
		expect(JSON.parse(store.get('vroom_offline_vehicles:user-a')!)[0].nickname).toBe('Mine');
	});

	it('a deleted vehicle leaves the cached list and takes its history with it', () => {
		useStore({});
		setOfflineQueueOwner('user-10');
		cacheVehicles([vehicle('v1', 'Gone'), vehicle('v2', 'Kept')], 'user-10');
		cacheVehicleHistory('v1', [], 'user-10');
		cacheVehicleHistory('v2', [], 'user-10');

		removeCachedVehicle('v1', 'user-10');

		expect(loadCachedVehicles().map(v => v.id)).toEqual(['v2']);
		expect(loadCachedVehicleHistory('v1')).toBeNull();
		expect(loadCachedVehicleHistory('v2')).toEqual([]);
	});

	it('an edited parked entry is requeued in place, keeping its identity and dropping cleared fields', async () => {
		const store = useStore({
			[scoped('user-8')]: JSON.stringify([
				queuedRow({
					id: 'parked',
					clientId: 'client-1',
					vehicleId: 'v1',
					date: '2026-01-06',
					timestamp: 111,
					category: 'fuel',
					amount: 1_000_001,
					volume: 10,
					needsAttention: true,
					attentionReason: 'Amount must be 1,000,000 or less'
				}),
				queuedRow({ id: 'other' })
			])
		});
		setOfflineQueueOwner('user-8');

		const saved = await replaceParkedExpense(
			'parked',
			{ vehicleId: 'v1', tags: [], category: 'misc', amount: 999.999, date: '2026-01-06' },
			[]
		);

		expect(saved).toBe('saved');
		const rows = JSON.parse(store.get(scoped('user-8'))!) as OfflineExpense[];
		expect(rows.map(r => r.id)).toEqual(['parked', 'other']);
		expect(rows[0]).toMatchObject({
			id: 'parked',
			clientId: 'client-1',
			timestamp: 111,
			category: 'misc',
			amount: 1000,
			synced: false
		});
		expect(rows[0]?.volume).toBeUndefined();
		expect(rows[0]?.needsAttention).toBeUndefined();
		expect(rows[0]?.attentionReason).toBeUndefined();
		expect(getPendingExpenses().map(r => r.id)).toContain('parked');
	});

	const requeueInput = {
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 5,
		date: '2026-01-06'
	};

	it('only a parked entry that never reached the server can be replaced', async () => {
		const rows = [
			queuedRow({ id: 'done', synced: true, needsAttention: true }),
			queuedRow({ id: 'syncing' }),
			queuedRow({ id: 'photo-only', needsAttention: true, serverId: 's1' })
		];
		const store = useStore({ [scoped('user-9')]: JSON.stringify(rows) });
		setOfflineQueueOwner('user-9');

		for (const id of ['done', 'syncing', 'photo-only', 'gone']) {
			expect(await replaceParkedExpense(id, requeueInput, [])).toBe('not-parked');
			expect(findParkedExpense(id)).toBeUndefined();
		}
		expect(JSON.parse(store.get(scoped('user-9'))!)).toEqual(rows);
	});

	it('a retry that unparks the entry while it is being edited wins, and the edit is refused', async () => {
		const parked = queuedRow({ id: 'parked', needsAttention: true, amount: 1_000_001 });
		const store = useStore({ [scoped('user-10')]: JSON.stringify([parked]) });
		setOfflineQueueOwner('user-10');
		expect(findParkedExpense('parked')).toBeDefined();
		store.set(scoped('user-10'), JSON.stringify([{ ...parked, needsAttention: false }]));

		expect(await replaceParkedExpense('parked', requeueInput, [])).toBe('not-parked');
		expect(JSON.parse(store.get(scoped('user-10'))!)[0].amount).toBe(1_000_001);
	});

	it('a photo write that fails leaves the parked entry as it was', async () => {
		vi.stubGlobal('indexedDB', undefined);
		const parked = queuedRow({ id: 'parked', clientId: 'c1', needsAttention: true });
		const store = useStore({ [scoped('user-11')]: JSON.stringify([parked]) });
		setOfflineQueueOwner('user-11');
		const photo = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });

		expect(await replaceParkedExpense('parked', requeueInput, [photo])).toBe('failed');
		expect(JSON.parse(store.get(scoped('user-11'))!)).toEqual([parked]);
	});

	it('an edit refused by a retry that unparked the entry puts the previous photos back', async () => {
		const db = fakePhotoDb();
		vi.stubGlobal('indexedDB', db);
		const before = new File(['old'], 'before.jpg', { type: 'image/jpeg' });
		const edited = new File(['new'], 'edited.jpg', { type: 'image/jpeg' });
		db.photos.set('c1', [before]);
		const parked = queuedRow({
			id: 'parked',
			clientId: 'c1',
			vehicleId: 'v1',
			date: '2026-01-06',
			needsAttention: true
		});
		const store = useStore({ [scoped('user-12')]: JSON.stringify([parked]) });
		setOfflineQueueOwner('user-12');

		const pending = replaceParkedExpense('parked', requeueInput, [edited]);
		store.set(scoped('user-12'), JSON.stringify([{ ...parked, needsAttention: false }]));

		expect(await pending).toBe('not-parked');
		expect(db.photos.get('c1')).toEqual([before]);
	});

	function parkedWithPhoto(owner: string, overrides: Partial<OfflineExpense> = {}) {
		const db = fakePhotoDb();
		vi.stubGlobal('indexedDB', db);
		const before = new File(['old'], 'before.jpg', { type: 'image/jpeg' });
		db.photos.set('c1', [before]);
		const parked = queuedRow({
			id: 'parked',
			clientId: 'c1',
			vehicleId: 'v1',
			date: '2026-01-06',
			needsAttention: true,
			...overrides
		});
		const store = useStore({ [scoped(owner)]: JSON.stringify([parked]) });
		setOfflineQueueOwner(owner);
		const edited = new File(['new'], 'edited.jpg', { type: 'image/jpeg' });
		return { db, store, parked, before, edited };
	}

	function failQueueWrites(owner: string) {
		localStorageMock.setItem.mockImplementation((key: string) => {
			if (key === scoped(owner)) throw new DOMException('quota', 'QuotaExceededError');
		});
	}

	it('a queue write that fails puts the previous photos back', async () => {
		const { db, store, parked, before, edited } = parkedWithPhoto('user-14');
		failQueueWrites('user-14');

		expect(await replaceParkedExpense('parked', requeueInput, [edited])).toBe('failed');

		expect(db.photos.get('c1')).toEqual([before]);
		expect(JSON.parse(store.get(scoped('user-14'))!)).toEqual([parked]);
	});

	it('a queue write that fails for a moved entry drops the new photos and keeps the old ones', async () => {
		const { db, before, edited } = parkedWithPhoto('user-15', { vehicleId: 'v2' });
		failQueueWrites('user-15');

		expect(await replaceParkedExpense('parked', requeueInput, [edited])).toBe('failed');

		expect([...db.photos.keys()]).toEqual(['c1']);
		expect(db.photos.get('c1')).toEqual([before]);
	});

	it('a refused edit for a moved entry drops the new photos and keeps the old ones', async () => {
		const { db, store, parked, before, edited } = parkedWithPhoto('user-16', {
			date: '2026-01-05'
		});

		const pending = replaceParkedExpense('parked', requeueInput, [edited]);
		store.set(scoped('user-16'), JSON.stringify([{ ...parked, needsAttention: false }]));

		expect(await pending).toBe('not-parked');
		expect([...db.photos.keys()]).toEqual(['c1']);
		expect(db.photos.get('c1')).toEqual([before]);
	});

	it('an edit that moves the entry to another vehicle on the same day gets a fresh client id', async () => {
		const { store, edited } = parkedWithPhoto('user-17', { vehicleId: 'v2' });

		expect(await replaceParkedExpense('parked', requeueInput, [edited])).toBe('saved');

		const [row] = JSON.parse(store.get(scoped('user-17'))!) as OfflineExpense[];
		expect(row?.clientId).toBeDefined();
		expect(row?.clientId).not.toBe('c1');
	});

	it('a photo read that fails still lets the edit through', async () => {
		const { db, store, edited } = parkedWithPhoto('user-18');
		const transaction = db.database.transaction;
		let first = true;
		db.database.transaction = (...args: Parameters<typeof transaction>) => {
			if (first) {
				first = false;
				throw new DOMException('broken', 'InvalidStateError');
			}
			return transaction(...args);
		};

		expect(await replaceParkedExpense('parked', requeueInput, [edited])).toBe('saved');

		expect(db.photos.get('c1')).toEqual([edited]);
		const [row] = JSON.parse(store.get(scoped('user-18'))!) as OfflineExpense[];
		expect(row?.clientId).toBe('c1');
	});

	it('an edit saved without its photos keeps the stored photos untouched', async () => {
		const { db, store, before } = parkedWithPhoto('user-19');

		expect(await replaceParkedExpense('parked', requeueInput, null)).toBe('saved');

		expect(db.photos.get('c1')).toEqual([before]);
		const [row] = JSON.parse(store.get(scoped('user-19'))!) as OfflineExpense[];
		expect(row?.clientId).toBe('c1');
	});

	it('a moved entry saved without its photos carries the stored photos to its new id', async () => {
		const { db, store, before } = parkedWithPhoto('user-20', { vehicleId: 'v2' });

		expect(await replaceParkedExpense('parked', requeueInput, null)).toBe('saved');

		const [row] = JSON.parse(store.get(scoped('user-20'))!) as OfflineExpense[];
		expect(row?.clientId).not.toBe('c1');
		expect(db.photos.get(row!.clientId!)).toEqual([before]);
		expect(db.photos.has('c1')).toBe(false);
	});

	it('a queue write that fails for a moved entry drops the copied photos and keeps the originals', async () => {
		const { db, store, parked, before } = parkedWithPhoto('user-22', { vehicleId: 'v2' });
		let photosAtQueueWrite = new Map<string, File[]>();
		localStorageMock.setItem.mockImplementation((key: string) => {
			if (key !== scoped('user-22')) return;
			photosAtQueueWrite = new Map(db.photos);
			throw new DOMException('quota', 'QuotaExceededError');
		});

		expect(await replaceParkedExpense('parked', requeueInput, null)).toBe('failed');

		const copies = [...photosAtQueueWrite].filter(([key]) => key !== 'c1');
		expect(copies).toEqual([[expect.any(String), [before]]]);
		expect([...db.photos.keys()]).toEqual(['c1']);
		expect(db.photos.get('c1')).toEqual([before]);
		expect(JSON.parse(store.get(scoped('user-22'))!)).toEqual([parked]);
	});

	it('a moved entry whose stored photos still cannot be read is refused, keeping them', async () => {
		const { db, store, parked, before } = parkedWithPhoto('user-21', { vehicleId: 'v2' });
		const transaction = db.database.transaction;
		let first = true;
		db.database.transaction = (...args: Parameters<typeof transaction>) => {
			if (first) {
				first = false;
				throw new DOMException('broken', 'InvalidStateError');
			}
			return transaction(...args);
		};

		expect(await replaceParkedExpense('parked', requeueInput, null)).toBe('photos-unreadable');

		expect(db.photos.get('c1')).toEqual([before]);
		expect(JSON.parse(store.get(scoped('user-21'))!)).toEqual([parked]);
	});

	it('an edit that moves the entry to another vehicle or day gets a fresh client id, and its photos move with it', async () => {
		const db = fakePhotoDb();
		vi.stubGlobal('indexedDB', db);
		const receipt = new File(['r'], 'receipt.jpg', { type: 'image/jpeg' });
		db.photos.set('c1', [receipt]);
		const store = useStore({
			[scoped('user-13')]: JSON.stringify([
				queuedRow({
					id: 'parked',
					clientId: 'c1',
					vehicleId: 'v1',
					date: '2026-01-05',
					needsAttention: true
				})
			])
		});
		setOfflineQueueOwner('user-13');

		expect(await replaceParkedExpense('parked', requeueInput, [receipt])).toBe('saved');

		const [row] = JSON.parse(store.get(scoped('user-13'))!) as OfflineExpense[];
		expect(row?.clientId).toBeDefined();
		expect(row?.clientId).not.toBe('c1');
		expect(db.photos.get(row!.clientId!)).toEqual([receipt]);
		expect(db.photos.has('c1')).toBe(false);
	});
});
