import { describe, expect, test } from 'vitest';

export interface RatchetSpec {
	name: string;
	scan: () => string[];
	tolerated: Iterable<string>;
	guidance: string;
	probe: () => void;
	kind?: 'debt' | 'exclusion';
}

function staleAdvice(kind: 'debt' | 'exclusion'): string {
	return kind === 'exclusion'
		? 'no longer offend, so the exclusion is inaccurate. Delete the entr(y/ies) — keeping them ' +
				'means a real regression at that path would be silently tolerated'
		: 'are fixed. Delete their entr(y/ies) from the tolerated list so the guard tightens behind ' +
				'you; leaving them in silently re-permits the defect at that path';
}

export function ratchet(spec: RatchetSpec): void {
	const kind = spec.kind ?? 'debt';

	describe(spec.name, () => {
		const offenders = [...new Set(spec.scan())].sort();
		const tolerated = [...new Set(spec.tolerated)].sort();

		test(`the matcher still matches what it polices (proven on fixtures, not on live ${kind})`, () => {
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
