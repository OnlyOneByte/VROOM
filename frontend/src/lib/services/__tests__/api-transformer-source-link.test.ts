import { describe, expect, test } from 'vitest';
import { toBackendExpense } from '../api-transformer';
import type { ExpenseCategory } from '#lib/types/index.ts';

const base = { vehicleId: 'v1', category: 'financial' as ExpenseCategory, amount: 400 };

describe('api-transformer source link', () => {
	test('sends a financing link on create', () => {
		const out = toBackendExpense({ ...base, sourceType: 'financing', sourceId: 'f1' });
		expect(out).toMatchObject({ sourceType: 'financing', sourceId: 'f1' });
	});

	test('sends the null pair on an edit that clears the link', () => {
		const out = toBackendExpense({ ...base, sourceType: null, sourceId: null }, { isEdit: true });
		expect(out.sourceType).toBeNull();
		expect(out.sourceId).toBeNull();
	});

	test('omits the link on an edit that leaves it alone', () => {
		const out = toBackendExpense({ ...base }, { isEdit: true });
		expect('sourceType' in out).toBe(false);
		expect('sourceId' in out).toBe(false);
	});

	test('never sends null on create', () => {
		const out = toBackendExpense({ ...base, sourceType: null, sourceId: null });
		expect('sourceType' in out).toBe(false);
	});
});
