/**
 * expense-location T4 — the api-transformer `location` mapping (both ways + the clear-on-edit contract).
 * Mirrors the `description` field exactly: toBackendExpense sets location when present, omits it on a
 * create with no value, and sends explicit `null` on an EDIT with an emptied value (so the backend's
 * .nullish() column clears); fromBackendExpense copies a present location through. Drives the REAL
 * transformer (not a re-implementation — the C181/C229 coverage-theater lesson).
 */

import { describe, expect, test } from 'vitest';
import { fromBackendExpense, toBackendExpense } from '../api-transformer';
import type { ExpenseCategory } from '$lib/types';

const base = { vehicleId: 'v1', category: 'misc' as ExpenseCategory, amount: 10 };

describe('api-transformer location mapping (expense-location T4)', () => {
	test('toBackendExpense sends a provided location', () => {
		const out = toBackendExpense({ ...base, location: 'Shell, Main St' });
		expect(out.location).toBe('Shell, Main St');
	});

	test('toBackendExpense omits location on a create with no value (offline-safe payload)', () => {
		const out = toBackendExpense({ ...base });
		expect('location' in out).toBe(false);
	});

	test('toBackendExpense sends location:null on an EDIT with an emptied value (clear-on-edit)', () => {
		const out = toBackendExpense({ ...base, location: '' }, { isEdit: true });
		expect(out.location).toBeNull();
	});

	test('toBackendExpense leaves location absent on a NON-edit with no value', () => {
		const out = toBackendExpense({ ...base, location: '' });
		expect('location' in out).toBe(false);
	});

	test('fromBackendExpense copies a present location through', () => {
		const fe = fromBackendExpense({
			id: 'e1',
			vehicleId: 'v1',
			userId: 'u1',
			tags: [],
			category: 'misc',
			expenseAmount: 10,
			date: '2026-03-12T12:00:00.000Z',
			location: 'Downtown garage',
			createdAt: '2026-03-12T12:00:00.000Z',
			updatedAt: '2026-03-12T12:00:00.000Z'
		});
		expect(fe.location).toBe('Downtown garage');
	});

	test('fromBackendExpense leaves location undefined when the row has none (null/absent)', () => {
		const fe = fromBackendExpense({
			id: 'e2',
			vehicleId: 'v1',
			userId: 'u1',
			tags: [],
			category: 'misc',
			expenseAmount: 10,
			date: '2026-03-12T12:00:00.000Z',
			location: null,
			createdAt: '2026-03-12T12:00:00.000Z',
			updatedAt: '2026-03-12T12:00:00.000Z'
		});
		expect(fe.location).toBeUndefined();
	});
});
