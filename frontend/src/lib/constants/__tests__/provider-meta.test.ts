import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import {
	defaultFolderSettings,
	providerLabel,
	providerUi,
	supportsSheetsBackup,
	supportsZipBackup
} from '#lib/constants/providers.ts';
import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';
import RestoreProviderPicker from '#lib/components/settings/storage-provider/backup/RestoreProviderPicker.svelte';

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getCatalog: async () => {
			const { STORAGE_CATALOG } =
				await import('#lib/stores/__tests__/provider-catalog-fixtures.ts');
			return [
				...STORAGE_CATALOG,
				{ ...STORAGE_CATALOG[1], id: 'webdav', label: 'WebDAV', shortLabel: 'WebDAV' }
			];
		}
	}
}));

beforeAll(() => providerCatalog.ensureLoaded());
afterEach(() => cleanup());

describe('storage provider helpers read the catalog', () => {
	test('labels come from the catalog, then the UI fallback, then the raw type', () => {
		expect(providerLabel('google-drive')).toBe('Google Drive');
		expect(providerLabel('s3')).toBe('S3 Compatible');
		expect(providerLabel('google-photos')).toBe('Google Photos');
		expect(providerLabel('dropbox')).toBe('dropbox');
		expect(providerUi('toString')).toBeNull();
		expect(providerUi(null)).toBeNull();
	});

	test('ZIP and Sheets backup follow the catalog features', () => {
		expect(supportsZipBackup('google-drive')).toBe(true);
		expect(supportsZipBackup('s3')).toBe(true);
		expect(supportsZipBackup('google-photos')).toBe(false);
		expect(supportsZipBackup(null)).toBe(false);
		expect(supportsSheetsBackup('google-drive')).toBe(true);
		expect(supportsSheetsBackup('s3')).toBe(false);
	});

	test('folder defaults come from the catalog', () => {
		expect(defaultFolderSettings('s3').vehicle_photos).toEqual({
			enabled: true,
			folderPath: 'vehicles'
		});
	});

	test('a type only the catalog knows shows its label in the restore picker', () => {
		render(RestoreProviderPicker, {
			props: {
				providers: [
					{
						providerId: 'p-1',
						providerType: 'webdav',
						displayName: 'NAS',
						accountEmail: 'nas.local',
						sourceTypes: ['zip']
					}
				],
				onSelect: () => {}
			}
		});
		expect(screen.getByText(/nas\.local · WebDAV/)).toBeTruthy();
	});

	test('the restore picker names Google Photos, which the catalog hides', () => {
		render(RestoreProviderPicker, {
			props: {
				providers: [
					{
						providerId: 'p-2',
						providerType: 'google-photos',
						displayName: 'Photos',
						accountEmail: 'me@example.com',
						sourceTypes: ['zip']
					}
				],
				onSelect: () => {}
			}
		});
		expect(screen.getByText(/me@example\.com · Google Photos/)).toBeTruthy();
	});
});
