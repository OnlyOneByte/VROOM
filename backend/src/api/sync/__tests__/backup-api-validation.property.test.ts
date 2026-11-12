import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { backupConfigSchema } from '../../settings/validation';
import { restoreFromProviderSchema } from '../routes';

const providerIdArb = fc.stringMatching(/^prov-[a-z0-9]{4,8}$/);
const validModeArb = fc.constantFrom('preview', 'replace', 'merge');
const validProviderIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/);
const validFileRefArb = fc.stringMatching(/^[a-zA-Z0-9_./-]{1,100}$/);
const validFolderPathArb = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/), { minLength: 1, maxLength: 5 })
  .map((segments) => segments.join('/'));
const validRetentionCountArb = fc.integer({ min: 1, max: 100 });

describe('Restore endpoint input validation', () => {
  test('accepts valid ZIP variant with sourceType, providerId, fileRef, mode', () => {
    fc.assert(
      fc.property(
        validProviderIdArb,
        validFileRefArb,
        validModeArb,
        (providerId, fileRef, mode) => {
          const result = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId,
            fileRef,
            mode,
          });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('accepts valid Sheets variant with sourceType, providerId, mode (no fileRef)', () => {
    fc.assert(
      fc.property(validProviderIdArb, validModeArb, (providerId, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'sheets',
          providerId,
          mode,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with empty providerId', () => {
    fc.assert(
      fc.property(validFileRefArb, validModeArb, (fileRef, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId: '',
          fileRef,
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects Sheets variant with empty providerId', () => {
    fc.assert(
      fc.property(validModeArb, (mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'sheets',
          providerId: '',
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with providerId longer than 64 chars', () => {
    const longProviderIdArb = fc.stringMatching(/^[a-z]{65,80}$/);
    fc.assert(
      fc.property(longProviderIdArb, validFileRefArb, validModeArb, (providerId, fileRef, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId,
          fileRef,
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with empty fileRef', () => {
    fc.assert(
      fc.property(validProviderIdArb, validModeArb, (providerId, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId,
          fileRef: '',
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects ZIP variant with missing fileRef', () => {
    fc.assert(
      fc.property(validProviderIdArb, validModeArb, (providerId, mode) => {
        const result = restoreFromProviderSchema.safeParse({
          sourceType: 'zip',
          providerId,
          mode,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects invalid mode values for both variants', () => {
    const invalidModeArb = fc
      .stringMatching(/^[a-z]{3,10}$/)
      .filter((s) => !['preview', 'replace', 'merge'].includes(s));
    fc.assert(
      fc.property(
        validProviderIdArb,
        validFileRefArb,
        invalidModeArb,
        (providerId, fileRef, mode) => {
          const zipResult = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId,
            fileRef,
            mode,
          });
          expect(zipResult.success).toBe(false);

          const sheetsResult = restoreFromProviderSchema.safeParse({
            sourceType: 'sheets',
            providerId,
            mode,
          });
          expect(sheetsResult.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects missing sourceType', () => {
    fc.assert(
      fc.property(
        validProviderIdArb,
        validFileRefArb,
        validModeArb,
        (providerId, fileRef, mode) => {
          const result = restoreFromProviderSchema.safeParse({ providerId, fileRef, mode });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects invalid sourceType', () => {
    const invalidSourceTypeArb = fc
      .stringMatching(/^[a-z]{3,10}$/)
      .filter((s) => !['zip', 'sheets'].includes(s));
    fc.assert(
      fc.property(
        invalidSourceTypeArb,
        validProviderIdArb,
        validModeArb,
        (sourceType, providerId, mode) => {
          const result = restoreFromProviderSchema.safeParse({ sourceType, providerId, mode });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects non-string providerId and fileRef', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
        (badValue) => {
          const result1 = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId: badValue,
            fileRef: 'valid',
            mode: 'preview',
          });
          expect(result1.success).toBe(false);

          const result2 = restoreFromProviderSchema.safeParse({
            sourceType: 'zip',
            providerId: 'valid',
            fileRef: badValue,
            mode: 'preview',
          });
          expect(result2.success).toBe(false);

          const result3 = restoreFromProviderSchema.safeParse({
            sourceType: 'sheets',
            providerId: badValue,
            mode: 'preview',
          });
          expect(result3.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('BackupConfig validation', () => {
  const validProviderSettingsArb = fc.record({
    enabled: fc.boolean(),
    folderPath: validFolderPathArb,
    retentionCount: validRetentionCountArb,
  });

  const validBackupConfigArb = fc
    .array(fc.tuple(providerIdArb, validProviderSettingsArb), { minLength: 0, maxLength: 10 })
    .map((entries) => {
      const seen = new Set<string>();
      const unique = entries.filter(([id]) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return {
        providers: Object.fromEntries(unique),
      };
    });

  test('accepts valid configs with valid folderPath, retentionCount, and ≤20 providers', () => {
    fc.assert(
      fc.property(validBackupConfigArb, (config) => {
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects folderPath containing ".." (path traversal)', () => {
    const pathTraversalArb = fc.constantFrom(
      'Backups/../etc',
      '../secrets',
      'foo/..bar/../baz',
      '..',
      'a/../b'
    );
    fc.assert(
      fc.property(providerIdArb, pathTraversalArb, (providerId, folderPath) => {
        const config = {
          providers: {
            [providerId]: { enabled: true, folderPath, retentionCount: 10 },
          },
        };
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects empty folderPath', () => {
    fc.assert(
      fc.property(providerIdArb, (providerId) => {
        const config = {
          providers: {
            [providerId]: { enabled: true, folderPath: '', retentionCount: 10 },
          },
        };
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('rejects retentionCount outside 1-100 range', () => {
    const invalidRetentionArb = fc.oneof(
      fc.integer({ min: -100, max: 0 }),
      fc.integer({ min: 101, max: 1000 })
    );
    fc.assert(
      fc.property(
        providerIdArb,
        validFolderPathArb,
        invalidRetentionArb,
        (providerId, folderPath, retentionCount) => {
          const config = {
            providers: {
              [providerId]: { enabled: true, folderPath, retentionCount },
            },
          };
          const result = backupConfigSchema.safeParse(config);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects non-integer retentionCount', () => {
    const nonIntArb = fc
      .double({ min: 1.01, max: 99.99, noNaN: true })
      .filter((n) => !Number.isInteger(n));
    fc.assert(
      fc.property(
        providerIdArb,
        validFolderPathArb,
        nonIntArb,
        (providerId, folderPath, retentionCount) => {
          const config = {
            providers: {
              [providerId]: { enabled: true, folderPath, retentionCount },
            },
          };
          const result = backupConfigSchema.safeParse(config);
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('rejects configs with more than 20 providers', () => {
    const tooManyProvidersArb = fc
      .array(providerIdArb, { minLength: 30, maxLength: 40 })
      .map((ids) => [...new Set(ids)])
      .filter((ids) => ids.length >= 21)
      .map((ids) => ids.slice(0, 21));

    fc.assert(
      fc.property(tooManyProvidersArb, (providerIds) => {
        const config = {
          providers: Object.fromEntries(
            providerIds.map((id) => [
              id,
              { enabled: true, folderPath: 'Backups', retentionCount: 10 },
            ])
          ),
        };
        expect(Object.keys(config.providers).length).toBeGreaterThan(20);
        const result = backupConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  test('accepts empty providers object', () => {
    const result = backupConfigSchema.safeParse({ providers: {} });
    expect(result.success).toBe(true);
  });
});
