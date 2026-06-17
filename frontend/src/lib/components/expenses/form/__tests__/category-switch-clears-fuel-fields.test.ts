/**
 * Source-scan GUARD (#76, C226) — switching an expense's category AWAY from 'fuel' must clear the
 * fuel-only formData fields (volume/charge/fuelType/mileage/missedFillup) in `selectCategory`.
 *
 * WHY: the fuel inputs hide via the `showFuelFields = category === 'fuel'` derived, but their
 * formData VALUES otherwise persist and ride along on submit — stamping a stale volume/charge/fuelType
 * onto a non-fuel row (inert in analytics, which filter category='fuel', but a real data-hygiene leak),
 * and a stray `mileage` would feed getCurrentOdometer cross-category. The form ALREADY clears
 * category-specific state on switch-away for the financing source; this extends that same idiom to fuel.
 *
 * This is a SOURCE SCAN (mirroring category-selector-labels.test.ts in this dir): `selectCategory`
 * mutates Svelte component-internal $state, not exercisable without mounting the component
 * (eyes-on/Playwright-blocked here). So we pin the load-bearing clear-block in the handler — a refactor
 * that drops it fails here, travelling with the merge. The block lives inside `selectCategory`, gated
 * on `categoryValue !== 'fuel'`. Runs in the fast unit suite (no browser, no server).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at .../expenses/form/__tests__/; the component is one level up.
const FORM_SRC = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'ExpenseForm.svelte'),
	'utf-8'
);

describe('category switch clears fuel fields (#76 source guard)', () => {
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
