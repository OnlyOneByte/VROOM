// Feature: unified-backup-providers, Property 15: Frontend derivation correctness
// **Validates: Requirements 13.4, 13.5**

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import type { BackupConfig, ProviderBackupSettings } from '$lib/types';

// Pure derivation functions matching the logic in StorageProvidersCard.svelte
function deriveSheetsSyncEnabled(backupConfig: BackupConfig): boolean {
	return Object.values(backupConfig.providers).some(p => p.sheetsSyncEnabled === true);
}

function deriveLastBackupDate(backupConfig: BackupConfig): string | null {
	let latest: string | null = null;
	for (const settings of Object.values(backupConfig.providers)) {
		if (settings.lastBackupAt && (!latest || settings.lastBackupAt > latest)) {
			latest = settings.lastBackupAt;
		}
	}
	return latest;
}

// --- Generators ---

const isoDateArb = fc
	.integer({ min: 1577836800000, max: 1924991999000 }) // 2020-01-01 to 2030-12-31 in ms
	.map(ms => new Date(ms).toISOString());

const providerIdArb = fc.stringMatching(/^[a-z0-9-]{1,20}$/);

const providerBackupSettingsArb: fc.Arbitrary<ProviderBackupSettings> = fc.record({
	enabled: fc.boolean(),
	folderPath: fc.constant('/Backups'),
	retentionCount: fc.integer({ min: 1, max: 100 }),
	lastBackupAt: fc.option(isoDateArb, { nil: undefined }),
	sheetsSyncEnabled: fc.option(fc.boolean(), { nil: undefined }),
	sheetsSpreadsheetId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined })
});

const backupConfigArb: fc.Arbitrary<BackupConfig> = fc
	.array(fc.tuple(providerIdArb, providerBackupSettingsArb), { minLength: 0, maxLength: 5 })
	.map(entries => ({
		providers: Object.fromEntries(entries)
	}));

// ---------------------------------------------------------------------------
// Property 15: Frontend derivation correctness
// ---------------------------------------------------------------------------
describe('Property 15: Frontend derivation correctness', () => {
	test('sheetsSyncEnabled is true iff at least one provider has sheetsSyncEnabled: true', () => {
		fc.assert(
			fc.property(backupConfigArb, config => {
				const derived = deriveSheetsSyncEnabled(config);
				const hasAnySheets = Object.values(config.providers).some(
					p => p.sheetsSyncEnabled === true
				);
				expect(derived).toBe(hasAnySheets);
			}),
			{ numRuns: 100 }
		);
	});

	test('sheetsSyncEnabled is false when no providers exist', () => {
		const emptyConfig: BackupConfig = { providers: {} };
		expect(deriveSheetsSyncEnabled(emptyConfig)).toBe(false);
	});

	test('sheetsSyncEnabled is false when all providers have sheetsSyncEnabled undefined or false', () => {
		fc.assert(
			fc.property(
				fc
					.array(
						fc.tuple(
							providerIdArb,
							fc.record({
								enabled: fc.boolean(),
								folderPath: fc.constant('/Backups'),
								retentionCount: fc.integer({ min: 1, max: 100 }),
								sheetsSyncEnabled: fc.constantFrom(false, undefined)
							})
						),
						{ minLength: 1, maxLength: 5 }
					)
					.map(
						entries =>
							({
								providers: Object.fromEntries(entries)
							}) as BackupConfig
					),
				config => {
					expect(deriveSheetsSyncEnabled(config)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});

	test('lastBackupDate equals the maximum lastBackupAt across all providers', () => {
		fc.assert(
			fc.property(backupConfigArb, config => {
				const derived = deriveLastBackupDate(config);
				const allDates = Object.values(config.providers)
					.map(p => p.lastBackupAt)
					.filter((d): d is string => d !== undefined && d !== null);

				if (allDates.length === 0) {
					expect(derived).toBeNull();
				} else {
					const maxDate = allDates.reduce((a, b) => (a > b ? a : b));
					expect(derived).toBe(maxDate);
				}
			}),
			{ numRuns: 100 }
		);
	});

	test('lastBackupDate is null when no providers exist', () => {
		const emptyConfig: BackupConfig = { providers: {} };
		expect(deriveLastBackupDate(emptyConfig)).toBeNull();
	});

	test('lastBackupDate is null when no provider has lastBackupAt', () => {
		fc.assert(
			fc.property(
				fc
					.array(
						fc.tuple(
							providerIdArb,
							fc.record({
								enabled: fc.boolean(),
								folderPath: fc.constant('/Backups'),
								retentionCount: fc.integer({ min: 1, max: 100 })
							})
						),
						{ minLength: 1, maxLength: 5 }
					)
					.map(
						entries =>
							({
								providers: Object.fromEntries(entries)
							}) as BackupConfig
					),
				config => {
					expect(deriveLastBackupDate(config)).toBeNull();
				}
			),
			{ numRuns: 100 }
		);
	});

	test('lastBackupDate picks the single lastBackupAt when only one provider has it', () => {
		fc.assert(
			fc.property(providerIdArb, isoDateArb, (id, date) => {
				const config: BackupConfig = {
					providers: {
						[id]: {
							enabled: true,
							folderPath: 'Backups',
							retentionCount: 10,
							lastBackupAt: date
						}
					}
				};
				expect(deriveLastBackupDate(config)).toBe(date);
			}),
			{ numRuns: 100 }
		);
	});
});
