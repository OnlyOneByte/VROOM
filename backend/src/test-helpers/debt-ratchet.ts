import { describe, expect, test } from 'bun:test';

/**
 * The shared shape for a source-scanning ratchet guard: a scan that finds offending sites, plus the
 * list of sites tolerated today.
 *
 * WHY THIS EXISTS. Hand-written ratchets in this repo kept failing in the same three ways, and all
 * three punished the person doing the right thing:
 *
 *  1. Asserting `expect(offenders).toEqual([...TOLERATED])` means FIXING a site turns the guard RED,
 *     because offenders is now shorter than the list. The fixer gets an array diff and has to work
 *     out that the correct response is to edit the list. Here the two directions are SEPARATE tests
 *     with distinct messages, so a fix either passes or tells you exactly which entry to delete.
 *  2. Proving the matcher is live by asserting a real file still matches (`expect(counts.get(f))
 *     .toBeGreaterThan(0)`) makes the guard UNSATISFIABLE once the list reaches zero — the goal
 *     state. Whoever lands the last fix can then only go green by weakening the guard. Here
 *     non-vacuity is proven against caller-supplied fixtures, which hold at zero.
 *  3. Keeping a ceiling (`MAX_FOO = 6`) beside the list lets the two drift, so the guard silently
 *     re-permits what was already fixed. Here the ceiling IS the list.
 *
 * Both directions still matter: a new offender must fail, and a stale entry must fail, because an
 * entry that no longer corresponds to anything silently re-permits that path.
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
   * Assert both polarities here — a matcher that never matches passes a subset check forever.
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
      const unexpected = offenders.filter((o) => !tolerated.includes(o));
      expect(unexpected, `${spec.guidance}\n${unexpected.join('\n')}`).toEqual([]);
    });

    test(`no stale entry in the tolerated ${kind} list`, () => {
      const stale = tolerated.filter((t) => !offenders.includes(t));
      expect(stale, `These ${staleAdvice(kind)}:\n${stale.join('\n')}`).toEqual([]);
    });
  });
}

/** Ratchet where each site tolerates a COUNT rather than merely existing. */
export function countRatchet(spec: {
  name: string;
  /** Recomputed per run: site -> how many occurrences it currently has. */
  scan: () => Map<string, number>;
  /** site -> the most occurrences tolerated today. The ceiling IS this record. */
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
      // The ceiling is derived from this record, so a count left too high re-permits what was
      // already fixed — the drift a separate MAX_ constant used to hide.
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
