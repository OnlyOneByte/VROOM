import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { resolveVroomFolderName } from '../folder-name';

describe('Property 1: Custom name passthrough with trimming', () => {
  test('for any non-empty-after-trim string, returns the trimmed custom name regardless of displayName', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1 }),
        (customName, displayName) => {
          const result = resolveVroomFolderName(customName, displayName);
          expect(result).toBe(customName.trim());
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 2: Empty input fallback to default name', () => {
  test('for null, undefined, empty, or whitespace-only input, returns default name pattern', () => {
    const emptyInputArb = fc.oneof(
      fc.constant(null as null | undefined | string),
      fc.constant(undefined as null | undefined | string),
      fc.constant('' as null | undefined | string),
      fc.nat({ max: 20 }).map((n) => ' '.repeat(n) as null | undefined | string)
    );

    fc.assert(
      fc.property(emptyInputArb, fc.string({ minLength: 1 }), (customName, displayName) => {
        const result = resolveVroomFolderName(customName, displayName);
        expect(result).toBe(`VROOM Car Tracker - ${displayName}`);
      }),
      { numRuns: 200 }
    );
  });
});
