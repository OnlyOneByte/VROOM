import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
	type OfflineExpense
} from '../offline-storage';
import { offlineExpenseQueue } from '$lib/stores/offline.svelte';

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

		it('addOfflineExpense propagates the failure to its caller (the save-offline toast depends on it)', () => {
			blockNextWrite(new DOMException('site data is blocked', 'SecurityError'));

			const queued = addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			});

			expect(queued).toBe(false);
		});

		it('addOfflineExpense returns true on a successful queue', () => {
			const queued = addOfflineExpense({
				vehicleId: 'vehicle-1',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			});

			expect(queued).toBe(true);
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

	describe('addOfflineExpense', () => {
		it('should add new expense with generated ID and timestamp', () => {
			const expenseData = {
				vehicleId: 'vehicle-1',
				type: 'fuel',
				tags: ['fuel'],
				category: 'fuel',
				amount: 50.0,
				date: '2024-01-01'
			};

			addOfflineExpense(expenseData);

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

		it('persists fuelType into the outbox so an electric charge survives sync', () => {
			addOfflineExpense({
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

		it('should append to existing expenses', () => {
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

			addOfflineExpense(newExpenseData);

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
