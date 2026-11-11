// Every offline save in ExpenseForm carries fuelType and missedFillup, on both the offline-first and error-fallback paths.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const COMPONENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'ExpenseForm.svelte');

// Brace-balanced extraction, so nested spreads inside each call body are included.
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

describe('ExpenseForm offline-save sites carry the fuel fields', () => {
	const source = readFileSync(COMPONENT, 'utf8');
	const bodies = extractAddOfflineExpenseBodies(source);

	test('the scan finds both offline-save call sites', () => {
		// A refactor that changes the call-site count must revisit this check rather than pass silently.
		expect(bodies.length).toBe(2);
	});

	test('every addOfflineExpense call carries missedFillup (— MPG-pairing correctness)', () => {
		const missing = bodies.filter(b => !b.includes('missedFillup'));
		expect(
			missing,
			`An addOfflineExpense(...) call omits missedFillup. Dropping it on sync makes ` +
				`calculateAverageMpg pair a missed fill-up across the unlogged gap → corrupted MPG ` +
				`. Carry it: ...(expenseData.missedFillup !== undefined && { missedFillup: ... }).`
		).toEqual([]);
	});

	test('every addOfflineExpense call carries fuelType (— electric charge survives sync)', () => {
		const missing = bodies.filter(b => !b.includes('fuelType'));
		expect(
			missing,
			`An addOfflineExpense(...) call omits fuelType. The sync transform needs it to keep an ` +
				`electric charge. Carry it on every offline-save path.`
		).toEqual([]);
	});
});
