import { describe, expect, test } from 'vitest';

/**
 * The shared shape for a source-scanning ratchet guard: a scan that finds offending sites, plus the
 * list of sites tolerated today. Mirrors backend/src/test-helpers/debt-ratchet.ts — same semantics,
 * different test runner.
 *
 * WHY THIS EXISTS. Hand-written ratchets here kept failing in three ways, all of which punished the
 * person doing the right thing:
 *
 *  1. `expect(offenders).toEqual([...TOLERATED])` turns RED when you FIX a site, because offenders
 *     is now shorter. The fixer gets an array diff and has to deduce that the right response is to
 *     edit the list. Here the two directions are SEPARATE tests with distinct messages, so a fix
 *     either passes or names the entry to delete.
 *  2. Proving the matcher is live by asserting a real site still matches makes the guard
 *     UNSATISFIABLE once the list reaches zero — the goal state. Whoever lands the last fix can then
 *     only go green by weakening the guard. Here non-vacuity is proven on fixtures, which hold at
 *     zero.
 *  3. A ceiling kept beside the list (`MAX_FOO = 6`) drifts from it, silently re-permitting what was
 *     already fixed. Here the ceiling IS the list.
 *
 * Both directions matter: a new offender must fail, and so must a stale entry, because an entry
 * corresponding to nothing silently re-permits that path.
 */
export interface RatchetSpec {
	/** What the guard polices, phrased for a test name. */
	name: string;
	/** Recomputed per run: the sites that currently offend. */
	scan: () => string[];
	/** The sites tolerated today. Empty means the class is closed — which must stay green. */
	tolerated: Iterable<string>;
	/** Shown when a NEW offender appears: say what to do instead, not just what is wrong. */
	guidance: string;
	/**
	 * Prove the matcher still matches what it claims to, using FIXTURES rather than live offenders.
	 * Assert both polarities — a matcher that never matches passes a subset check forever.
	 */
	probe: () => void;
	/**
	 * `debt` is expected to shrink to nothing; `exclusion` is a deliberate permanent choice. Only the
	 * wording differs — an inaccurate exclusion is as dangerous as stale debt, so both are checked.
	 */
	kind?: 'debt' | 'exclusion';
}

function staleAdvice(kind: 'debt' | 'exclusion'): string {
	return kind === 'exclusion'
		? 'no longer offend, so the exclusion is inaccurate. Delete the entr(y/ies) — keeping them ' +
				'means a real regression at that path would be silently tolerated'
		: 'are fixed. Delete their entr(y/ies) from the tolerated list so the guard tightens behind ' +
				'you; leaving them in silently re-permits the defect at that path';
}

/** Ratchet over a set of offending sites (paths, ids, rule names). */
export function ratchet(spec: RatchetSpec): void {
	const kind = spec.kind ?? 'debt';

	describe(spec.name, () => {
		const offenders = [...new Set(spec.scan())].sort();
		const tolerated = [...new Set(spec.tolerated)].sort();

		test(`the matcher still matches what it polices (proven on fixtures, not on live ${kind})`, () => {
			// Deliberately fixture-based: anchoring this on a real offender would make the whole guard
			// unsatisfiable the moment the tolerated list reaches zero.
			spec.probe();
		});

		test(`no new site outside the tolerated ${kind} list`, () => {
			const unexpected = offenders.filter(o => !tolerated.includes(o));
			expect(unexpected, `${spec.guidance}\n${unexpected.join('\n')}`).toEqual([]);
		});

		test(`no stale entry in the tolerated ${kind} list`, () => {
			const stale = tolerated.filter(t => !offenders.includes(t));
			expect(stale, `These ${staleAdvice(kind)}:\n${stale.join('\n')}`).toEqual([]);
		});
	});
}
