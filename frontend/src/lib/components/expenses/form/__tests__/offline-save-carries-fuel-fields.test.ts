/**
 * Regression GUARD (committed, merge-surviving) for the offline-field-dropout class at the ExpenseForm
 * CALL SITES — #66 (fuelType), #101 (missedFillup), #111 (missedFillup again, on the error-fallback save).
 *
 * ExpenseForm saves an offline expense from TWO places: the offline-first path (no network) and the
 * error-fallback path (an online create that throws → catch → save offline). The dropout bug recurs
 * because each `addOfflineExpense({...})` object is hand-built: a fuel field carried in one call but
 * forgotten in the other is silently dropped on that path, and on sync calculateAverageMpg pairs the
 * fill-up across the unlogged gap → corrupted MPG (NORTH_STAR #1). #101 was fixed on the offline-first
 * path (C339) but the SAME field was missing from the error-fallback save until #111 (C377).
 *
 * The mapper side (offlineExpenseToBackend) is fully pinned by offline-storage.test.ts (incl. the C347
 * completeness pin) — but the mapper can't carry a field the CALL SITE never put in the object. This
 * static scan pins the call sites: EVERY addOfflineExpense(...) in ExpenseForm must carry both
 * missedFillup and fuelType. A component runtime test would need Playwright (the catch path is
 * network-failure-gated) + would re-implement the form (the C229 trap), so a source scan is the
 * merge-surviving guard. Fast unit suite — no browser, no server.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at .../expenses/form/__tests__/; the component is one level up.
const COMPONENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ExpenseForm.svelte');

/**
 * Extract the argument body of every `addOfflineExpense({ ... })` call. The object literal is
 * brace-balanced from the first `{` after the call to its matching `}`, so a simple depth counter
 * isolates each call's body even with nested `{ ... }` spreads inside.
 */
function extractAddOfflineExpenseBodies(source: string): string[] {
	const bodies: string[] = [];
	const CALL = 'addOfflineExpense(';
	let idx = source.indexOf(CALL);
	while (idx !== -1) {
		const braceStart = source.indexOf('{', idx);
		if (braceStart === -1) break;
		let depth = 0;
		let end = braceStart;
		for (let i = braceStart; i < source.length; i++) {
			if (source[i] === '{') depth++;
			else if (source[i] === '}') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		bodies.push(source.slice(braceStart, end + 1));
		idx = source.indexOf(CALL, end);
	}
	return bodies;
}

describe('ExpenseForm offline-save sites carry the fuel fields (#66/#101/#111 dropout guard)', () => {
	const source = readFileSync(COMPONENT, 'utf8');
	const bodies = extractAddOfflineExpenseBodies(source);

	test('the scan found BOTH offline-save call sites (guard is live, not a no-op)', () => {
		// The offline-first path + the error-fallback path. If a refactor changes the count, revisit
		// this guard rather than letting it silently pass on a single (or zero) site.
		expect(bodies.length).toBe(2);
	});

	test('every addOfflineExpense call carries missedFillup (#101/#111 — MPG-pairing correctness)', () => {
		const missing = bodies.filter((b) => !b.includes('missedFillup'));
		expect(
			missing,
			`An addOfflineExpense(...) call omits missedFillup. Dropping it on sync makes ` +
				`calculateAverageMpg pair a missed fill-up across the unlogged gap → corrupted MPG ` +
				`(#101/#111). Carry it: ...(expenseData.missedFillup !== undefined && { missedFillup: ... }).`
		).toEqual([]);
	});

	test('every addOfflineExpense call carries fuelType (#66 — electric charge survives sync)', () => {
		const missing = bodies.filter((b) => !b.includes('fuelType'));
		expect(
			missing,
			`An addOfflineExpense(...) call omits fuelType. The sync transform needs it to keep an ` +
				`electric charge (#66). Carry it on every offline-save path.`
		).toEqual([]);
	});
});
