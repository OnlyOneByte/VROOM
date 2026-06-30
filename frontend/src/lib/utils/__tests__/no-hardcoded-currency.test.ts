/**
 * Regression GUARD (committed, travels with the merge) for the cycle-202 bug class:
 * hardcoded currency symbols in user-facing labels.
 *
 * Money-field labels and chart axis titles must show the user's currency symbol
 * (via getCurrencySymbol / formatCurrency), never a literal "$"/"€"/"£" — otherwise a
 * EUR/GBP user sees the wrong unit. The per-instance E2E guards for this class are
 * UNTRACKED (*.meshclaw.e2e.ts), so they don't survive a merge/fresh checkout; this
 * static source scan does, and catches the whole CLASS, not just the spots already found.
 *
 * It scans every .svelte source for a currency symbol in a parenthesized label-suffix
 * position — "($)", "(€)", "(£)" — which is exactly the c202 shape ("Deductible ($)").
 * The ONLY legitimate home for that pattern is the currency SELECTOR (it names which
 * dollar), so that one file is allowlisted. Any new hit is a real regression: route the
 * label through getCurrencySymbol() instead.
 *
 * Runs in the fast unit suite (`npm test`) — no browser, no server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { collectSvelteFiles } from './_helpers/collect-svelte-files';

// This file lives at src/lib/utils/__tests__/, so src/ is four levels up.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The currency SELECTOR legitimately renders "USD ($)", "EUR (€)", etc. — it names the
// currency, it isn't a money-field label. It's the sole sanctioned home for the pattern.
const ALLOWLIST = new Set<string>(['lib/components/settings/cards/UnitPreferencesCard.svelte']);

// A currency symbol sitting alone inside parentheses — the label-suffix shape from c202
// ("Deductible ($)"). Deliberately narrow so JS interpolation like `${x}` never matches.
const HARDCODED_CURRENCY_SUFFIX = /\(\s*[$€£]\s*\)/;

describe('no hardcoded currency symbols in user-facing labels (cycle-202 class guard)', () => {
	const files = collectSvelteFiles(SRC_ROOT);

	test('the scan actually found .svelte sources (guard is live, not a no-op)', () => {
		// If this ever hits 0, the path resolution broke and the guard is silently inert.
		expect(files.length).toBeGreaterThan(20);
	});

	test('no .svelte file hardcodes a currency symbol in a ($)/(€)/(£) label suffix', () => {
		const offenders: string[] = [];

		for (const file of files) {
			const rel = relative(SRC_ROOT, file).split('\\').join('/');
			if (ALLOWLIST.has(rel)) continue;

			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, idx) => {
				if (HARDCODED_CURRENCY_SUFFIX.test(line)) {
					offenders.push(`${rel}:${idx + 1}  ${line.trim()}`);
				}
			});
		}

		expect(
			offenders,
			`Hardcoded currency symbol(s) in a label suffix — route through getCurrencySymbol()/formatCurrency() so EUR/GBP users see the right unit (cycle 202):\n${offenders.join('\n')}`
		).toEqual([]);
	});

	test('the allowlisted currency selector is still present (allowlist not stale)', () => {
		// If UnitPreferencesCard moves/renames, the allowlist entry would silently stop
		// matching — fail loudly so the allowlist is kept honest.
		const allowlisted = [...ALLOWLIST][0];
		const exists = files.some((f) => relative(SRC_ROOT, f).split('\\').join('/') === allowlisted);
		expect(exists, `Allowlisted path no longer exists: ${allowlisted}`).toBe(true);
	});
});
