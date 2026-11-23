import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';

const COMPONENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'CategorySelector.svelte');

describe('CategorySelector labels stay single-word', () => {
	const labels = EXPENSE_CATEGORIES.map(category => EXPENSE_CATEGORY_INFO[category].shortLabel);

	test('the picker renders the short labels', () => {
		expect(labels.length).toBe(EXPENSE_CATEGORIES.length);
		expect(readFileSync(COMPONENT, 'utf8')).toContain('{category.shortLabel}');
	});

	test('no category label is multi-word (would wrap in the 2-col mobile grid)', () => {
		const offenders = labels.filter(label => /\s/.test(label.trim()));

		expect(
			offenders,
			`Multi-word CategorySelector label(s) found: ${JSON.stringify(offenders)}. ` +
				'A label with a space wraps to a second line in the grid-cols-2 mobile layout ' +
				'(floating the icon mid-card). Keep the shortLabel one word and put the ' +
				'detail in the description instead.'
		).toEqual([]);
	});
});
