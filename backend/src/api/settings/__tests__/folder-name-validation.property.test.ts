import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { z } from 'zod';

/**
 * Standalone folder name validation schema matching the one in settings routes.
 * Duplicated here to test the validation logic independently.
 */
const folderNameSchema = z
  .string()
  .max(255, 'Folder name must be 255 characters or fewer')
  .refine((s) => !s.includes('/') && !s.includes('\\'), {
    message: 'Folder name must not contain / or \\',
  });

describe('Property 3: Folder name validation correctness', () => {
  test('accepts strings without / or \\ that are 255 chars or fewer', () => {
    const validNameArb = fc
      .string({ minLength: 0, maxLength: 255 })
      .filter((s) => !s.includes('/') && !s.includes('\\'));

    fc.assert(
      fc.property(validNameArb, (name) => {
        const result = folderNameSchema.safeParse(name);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects strings containing /', () => {
    const nameWithSlashArb = fc
      .tuple(fc.string({ maxLength: 100 }), fc.string({ maxLength: 100 }))
      .map(([a, b]) => `${a}/${b}`);

    fc.assert(
      fc.property(nameWithSlashArb, (name) => {
        const result = folderNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects strings containing \\', () => {
    const nameWithBackslashArb = fc
      .tuple(fc.string({ maxLength: 100 }), fc.string({ maxLength: 100 }))
      .map(([a, b]) => `${a}\\${b}`);

    fc.assert(
      fc.property(nameWithBackslashArb, (name) => {
        const result = folderNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects strings longer than 255 characters', () => {
    // Generate long strings from safe characters to avoid slow filtering
    const safeChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 -_.'.split(''));
    const longNameArb = fc
      .array(safeChar, { minLength: 256, maxLength: 500 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(longNameArb, (name) => {
        const result = folderNameSchema.safeParse(name);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });
});
