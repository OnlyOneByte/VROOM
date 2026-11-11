import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { ratchet } from './_helpers/debt-ratchet';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Deductible ($)</Label>')).toBe(true);
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Premium (€)</Label>')).toBe(true);
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Cost (£)</Label>')).toBe(true);
		expect(HARDCODED_CURRENCY_SUFFIX.test('<Label>Deductible ({symbol})</Label>')).toBe(false);
		expect(HARDCODED_CURRENCY_SUFFIX.test('const total = `${amount}`;')).toBe(false);
		expect(
			files.length,
			'the .svelte walk found almost nothing — SRC_ROOT is wrong'
		).toBeGreaterThan(20);
	}
});
