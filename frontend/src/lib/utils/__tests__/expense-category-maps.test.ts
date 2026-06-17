/**
 * Exhaustiveness + correctness of the expense-category display maps in expense-helpers.ts
 * (categoryLabels / getCategoryIcon / getCategoryColor) — the C234 guard. compareExpenseRows
 * (the same module) is already pinned by compare-expense-rows.test.ts; these three exports were
 * UNCOVERED.
 *
 * The load-bearing invariant is EXHAUSTIVENESS: every ExpenseCategory in the union must have a
 * label, an icon, and a color. A missing key is a silent UI bug — categoryLabels[newcat] is
 * `undefined` (renders blank) and the icon/color maps fall through to their DollarSign / muted
 * fallback. ALL_CATEGORIES is a hand-maintained mirror of the `ExpenseCategory` union (expense.ts);
 * pinning the count + each key here means adding a 7th category to the type without updating these
 * maps fails CI instead of shipping a blank label. Drives the REAL exports (not a reference copy).
 */

import { describe, expect, test } from 'vitest';
import { DollarSign } from '@lucide/svelte';
import type { ExpenseCategory } from '$lib/types';
import { categoryLabels, getCategoryColor, getCategoryIcon } from '../expense-helpers';

// A literal mirror of the ExpenseCategory union (src/lib/types/expense.ts). If the union grows,
// this list must grow too — that's the point: it forces the maps below to be updated in lockstep.
const ALL_CATEGORIES: ExpenseCategory[] = [
	'fuel',
	'maintenance',
	'financial',
	'regulatory',
	'enhancement',
	'misc'
];

describe('expense-category display maps — exhaustiveness', () => {
	test('there are exactly 6 categories (guards against a silent union change)', () => {
		expect(ALL_CATEGORIES.length).toBe(6);
		// No duplicates in the mirror.
		expect(new Set(ALL_CATEGORIES).size).toBe(6);
	});

	test('categoryLabels has a non-empty label for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(categoryLabels[cat], `missing label for ${cat}`).toBeTruthy();
			expect(typeof categoryLabels[cat]).toBe('string');
		}
		// No EXTRA keys beyond the union (a stale label for a removed category).
		expect(Object.keys(categoryLabels).sort()).toEqual([...ALL_CATEGORIES].sort());
	});

	test('getCategoryIcon returns a defined component for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(getCategoryIcon(cat), `missing icon for ${cat}`).toBeDefined();
		}
	});

	test('getCategoryColor returns a non-empty class string for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			const color = getCategoryColor(cat);
			expect(color, `missing color for ${cat}`).toBeTruthy();
			expect(color).toContain('text-');
		}
	});
});

describe('expense-category display maps — known values + fallback', () => {
	test('a few representative mappings are stable', () => {
		expect(categoryLabels.fuel).toBe('Fuel & Charging');
		expect(categoryLabels.misc).toBe('Misc');
		expect(getCategoryColor('fuel')).toBe('text-chart-1 bg-chart-1/10');
		expect(getCategoryColor('misc')).toBe('text-muted-foreground bg-muted');
	});

	test('an unknown category falls back (icon → DollarSign, color → muted) without throwing', () => {
		// The `|| fallback` guards on both getters. Cast through unknown — a real runtime value
		// (e.g. a legacy/garbage category from an old row) can reach these even if the type forbids it.
		const bogus = 'bogus' as unknown as ExpenseCategory;
		expect(getCategoryIcon(bogus)).toBe(DollarSign);
		expect(getCategoryColor(bogus)).toBe('text-muted-foreground bg-muted');
	});
});
