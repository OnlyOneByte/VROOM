/**
 * Money-field labels and chart axis titles must show the USER'S currency symbol (via
 * `getCurrencySymbol` / `formatCurrency`), never a literal "$"/"€"/"£" — otherwise a EUR or GBP
 * user reads the wrong unit on an otherwise correct number, which is worse than no unit at all.
 *
 * A static source scan catches the whole CLASS rather than the spots already found, and unlike a
 * browser E2E it runs in the fast unit suite. It looks for a currency symbol alone inside
 * parentheses — "($)", "(€)", "(£)" — the label-suffix shape ("Deductible ($)"). Deliberately
 * narrow, so JS interpolation like `${x}` never matches.
 *
 * The currency SELECTOR is the one legitimate home for the pattern: it renders "USD ($)", "EUR
 * (€)" to name which currency, so there the symbol is the subject rather than a unit. That makes
 * it a permanent exclusion rather than debt — hence `kind: 'exclusion'`, which also checks the
 * other direction: if that file ever stops rendering a bare symbol, the entry is stale and must go,
 * because a stale entry silently exempts a real regression at that path.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is three levels up.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A currency symbol sitting alone inside parentheses — the label-suffix shape. */
const HARDCODED_CURRENCY_SUFFIX = /\(\s*[$€£]\s*\)/;

const files = collectSvelteFiles(SRC_ROOT);
const rel = (file: string) => relative(SRC_ROOT, file).split('\\').join('/');

ratchet({
	name: 'no hardcoded currency symbols in user-facing labels',
	kind: 'exclusion',
	tolerated: ['lib/components/settings/cards/UnitPreferencesCard.svelte'],
	guidance:
		'Hardcoded currency symbol(s) in a label suffix. Route the label through ' +
		'getCurrencySymbol()/formatCurrency() so EUR/GBP users see the right unit:',
	scan: () =>
		files.filter(file => HARDCODED_CURRENCY_SUFFIX.test(readFileSync(file, 'utf8'))).map(rel),
	probe: () => {
		// Fixtures, not live sites: the exclusion list is meant to stay at one entry, and anchoring
		// non-vacuity on that entry would break the moment the selector is redesigned.
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Deductible ($)</Label>')).toBe(true);
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Premium (€)</Label>')).toBe(true);
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Cost (£)</Label>')).toBe(true);
		// Must NOT fire on an interpolated symbol, which is the correct form.
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Deductible ({symbol})</Label>')).toBe(false);
		expect(HARDCODED_CURRENCY_SUFFIX.test('const total = `${amount}`;')).toBe(false);
		// And that the walk reaches the tree — a scan over nothing passes a subset check forever.
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});
