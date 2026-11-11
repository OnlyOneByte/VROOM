// Switching a category away from fuel must clear the fuel-only fields in selectCategory; source scan, since the state is component-internal.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const FORM_SRC = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'ExpenseForm.svelte'),
	'utf-8'
);

describe('category switch clears fuel fields', () => {
	test('selectCategory has a non-fuel branch that clears the fuel-only fields', () => {
		// Anchor on selectCategory, then assert the switch-away-from-fuel clear-block lives within it.
		const start = FORM_SRC.indexOf('function selectCategory');
		expect(start).toBeGreaterThan(-1);
		const block = FORM_SRC.slice(start, start + 1400);
		expect(block).toContain("categoryValue !== 'fuel'");
		expect(block).toContain('formData.volume');
		expect(block).toContain('formData.charge');
		expect(block).toContain('formData.fuelType');
		expect(block).toContain('formData.mileage');
	});
});
