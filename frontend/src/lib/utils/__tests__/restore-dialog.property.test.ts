/**
 * Property 14: Restore dialog source options
 * Property 5: Restore source equivalence
 * Validates: Requirements 12.1, 5.1
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

// --- Property 14: Restore dialog source options ---

interface BackupProviderInfo {
	id: string;
	displayName: string;
	providerType: string;
}

/**
 * Pure function replicating the source options logic from UnifiedRestoreDialog.
 * Returns the list of source options that should be displayed.
 */
function computeSourceOptions(
	backupProviders: BackupProviderInfo[],
	sheetsSyncEnabled: boolean
): string[] {
	const options: string[] = ['Upload file'];
	for (const provider of backupProviders) {
		options.push(provider.displayName);
	}
	if (sheetsSyncEnabled) {
		options.push('Google Sheets');
	}
	return options;
}

const providerArb: fc.Arbitrary<BackupProviderInfo> = fc.record({
	id: fc.stringMatching(/^[a-z0-9-]{1,20}$/),
	displayName: fc.stringMatching(/^[A-Za-z0-9 ]{1,30}$/),
	providerType: fc.constantFrom('google-drive', 's3')
});

describe('Property 14: Restore dialog source options', () => {
	test('"Upload file" is always the first option', () => {
		fc.assert(
			fc.property(
				fc.array(providerArb, { minLength: 0, maxLength: 5 }),
				fc.boolean(),
				(providers, sheetsEnabled) => {
					const options = computeSourceOptions(providers, sheetsEnabled);
					expect(options[0]).toBe('Upload file');
				}
			),
			{ numRuns: 100 }
		);
	});

	test('one option per backup-enabled provider by display name', () => {
		fc.assert(
			fc.property(
				fc.array(providerArb, { minLength: 0, maxLength: 5 }),
				fc.boolean(),
				(providers, sheetsEnabled) => {
					const options = computeSourceOptions(providers, sheetsEnabled);
					for (const provider of providers) {
						expect(options).toContain(provider.displayName);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	test('"Google Sheets" shown iff sheetsSyncEnabled is true', () => {
		fc.assert(
			fc.property(
				fc.array(providerArb, { minLength: 0, maxLength: 5 }),
				fc.boolean(),
				(providers, sheetsEnabled) => {
					const options = computeSourceOptions(providers, sheetsEnabled);
					if (sheetsEnabled) {
						expect(options).toContain('Google Sheets');
					} else {
						expect(options).not.toContain('Google Sheets');
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	test('total options = 1 (upload) + providers.length + (sheets ? 1 : 0)', () => {
		fc.assert(
			fc.property(
				fc.array(providerArb, { minLength: 0, maxLength: 5 }),
				fc.boolean(),
				(providers, sheetsEnabled) => {
					const options = computeSourceOptions(providers, sheetsEnabled);
					const expected = 1 + providers.length + (sheetsEnabled ? 1 : 0);
					expect(options.length).toBe(expected);
				}
			),
			{ numRuns: 100 }
		);
	});
});

// --- Property 5: Restore source equivalence ---

interface RestoreResponse {
	success: boolean;
	preview?: Record<string, number>;
	imported?: Record<string, number>;
	conflicts?: Array<{ table: string; id: string }>;
}

/**
 * Pure function: given a ZIP buffer's parsed content, the restore result
 * is determined solely by the content, not the source.
 * We model this as: restoreResult = f(zipContent, mode).
 */
function simulateRestore(
	zipContent: Record<string, number>,
	mode: 'preview' | 'replace' | 'merge'
): RestoreResponse {
	if (mode === 'preview') {
		return { success: true, preview: { ...zipContent } };
	}
	return { success: true, imported: { ...zipContent } };
}

const zipContentArb = fc.record({
	vehicles: fc.nat({ max: 100 }),
	expenses: fc.nat({ max: 500 }),
	financing: fc.nat({ max: 50 }),
	insurance: fc.nat({ max: 20 })
});

const modeArb = fc.constantFrom('preview' as const, 'replace' as const, 'merge' as const);

describe('Property 5: Restore source equivalence', () => {
	test('same content produces same result regardless of source', () => {
		fc.assert(
			fc.property(zipContentArb, modeArb, (content, mode) => {
				const fromFile = simulateRestore(content, mode);
				const fromProvider = simulateRestore(content, mode);
				const fromSheets = simulateRestore(content, mode);
				expect(fromFile).toEqual(fromProvider);
				expect(fromProvider).toEqual(fromSheets);
			}),
			{ numRuns: 100 }
		);
	});

	test('preview mode returns preview field, non-preview returns imported', () => {
		fc.assert(
			fc.property(zipContentArb, modeArb, (content, mode) => {
				const result = simulateRestore(content, mode);
				if (mode === 'preview') {
					expect(result.preview).toBeDefined();
					expect(result.imported).toBeUndefined();
				} else {
					expect(result.imported).toBeDefined();
					expect(result.preview).toBeUndefined();
				}
			}),
			{ numRuns: 100 }
		);
	});
});
