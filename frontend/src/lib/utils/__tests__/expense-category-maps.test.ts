import { describe, expect, test } from 'vitest';
import { DollarSign } from '@lucide/svelte';
import type { ExpenseCategory } from '#lib/types/index.ts';
import { categoryLabels, getCategoryBadgeClasses, getCategoryIcon } from '../expense-helpers';

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
		expect(new Set(ALL_CATEGORIES).size).toBe(6);
	});

	test('categoryLabels has a non-empty label for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(categoryLabels[cat], `missing label for ${cat}`).toBeTruthy();
			expect(typeof categoryLabels[cat]).toBe('string');
		}
		expect(Object.keys(categoryLabels).sort()).toEqual([...ALL_CATEGORIES].sort());
	});

	test('getCategoryIcon returns a defined component for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(getCategoryIcon(cat), `missing icon for ${cat}`).toBeDefined();
		}
	});

	test('getCategoryBadgeClasses returns a non-empty class string for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			const color = getCategoryBadgeClasses(cat);
			expect(color, `missing color for ${cat}`).toBeTruthy();
			expect(color).toContain('text-');
		}
	});
});

describe('expense-category display maps — known values + fallback', () => {
	test('a few representative mappings are stable', () => {
		expect(categoryLabels.fuel).toBe('Fuel & Charging');
		expect(categoryLabels.misc).toBe('Misc');
		expect(getCategoryBadgeClasses('fuel')).toBe('text-chart-1 bg-chart-1/10');
		expect(getCategoryBadgeClasses('misc')).toBe('text-muted-foreground bg-muted');
	});

	test('an unknown category falls back (icon → DollarSign, color → muted) without throwing', () => {
		const bogus = 'bogus' as unknown as ExpenseCategory;
		expect(getCategoryIcon(bogus)).toBe(DollarSign);
		expect(getCategoryBadgeClasses(bogus)).toBe('text-muted-foreground bg-muted');
	});
});
