import { describe, expect, test } from 'bun:test';

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
      const unexpected = offenders.filter((o) => !tolerated.includes(o));
      expect(unexpected, `${spec.guidance}\n${unexpected.join('\n')}`).toEqual([]);
    });

    test(`no stale entry in the tolerated ${kind} list`, () => {
      const stale = tolerated.filter((t) => !offenders.includes(t));
      expect(stale, `These ${staleAdvice(kind)}:\n${stale.join('\n')}`).toEqual([]);
    });
  });
}

export function countRatchet(spec: {
  name: string;
  scan: () => Map<string, number>;
  tolerated: Record<string, number>;
  guidance: string;
  probe: () => void;
}): void {
  describe(spec.name, () => {
    const counts = spec.scan();
    const toleratedKeys = Object.keys(spec.tolerated).sort();

    test('the matcher still matches what it polices (proven on fixtures, not on live counts)', () => {
      spec.probe();
    });

    test('no new site outside the tolerated list', () => {
      const unexpected = [...counts.keys()].filter((f) => !(f in spec.tolerated)).sort();
      expect(unexpected, `${spec.guidance}\n${unexpected.join('\n')}`).toEqual([]);
    });

    test('no tolerated site has grown', () => {
      const grown = [...counts.entries()]
        .filter(([file, n]) => file in spec.tolerated && n > (spec.tolerated[file] ?? 0))
        .map(([file, n]) => `${file}: ${n} > ${spec.tolerated[file]} tolerated`)
        .sort();
      expect(grown, `${spec.guidance}\n${grown.join('\n')}`).toEqual([]);
    });

    test('no tolerated count is stale (fixed sites must be removed, lowered counts tightened)', () => {
      const stale = toleratedKeys
        .filter((file) => (counts.get(file) ?? 0) < (spec.tolerated[file] ?? 0))
        .map(
          (file) => `${file}: ${counts.get(file) ?? 0} actual < ${spec.tolerated[file]} tolerated`
        );
      expect(
        stale,
        'Lower these counts (or delete the entry at 0) so the ceiling tightens behind your fix:\n' +
          stale.join('\n')
      ).toEqual([]);
    });
  });
}
