import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { HardDrive } from '@lucide/svelte';
import { PROVIDER_META, providerLabel, providerMeta } from '#lib/constants/providers.ts';
import RestoreProviderPicker from '#lib/components/settings/storage-provider/backup/RestoreProviderPicker.svelte';

afterEach(() => cleanup());

describe('PROVIDER_META', () => {
	test('labels every known storage type and falls back to the raw type', () => {
		expect(providerLabel('google-drive')).toBe('Google Drive');
		expect(providerLabel('google-photos')).toBe('Google Photos');
		expect(providerLabel('s3')).toBe('S3 Compatible');
		expect(providerLabel('webdav')).toBe('webdav');
		expect(providerMeta('toString')).toBeNull();
		expect(providerMeta(null)).toBeNull();
	});

	test('a type added only to PROVIDER_META shows its label in the restore picker', () => {
		PROVIDER_META['webdav'] = {
			label: 'WebDAV',
			icon: HardDrive,
			form: null,
			option: null,
			defaultPhotoRootPath: 'photos',
			supportsSheets: false,
			photoOnly: false,
			defaultFolders: {
				vehicle_photos: 'v',
				expense_receipts: 'r',
				insurance_docs: 'i',
				odometer_readings: 'o'
			}
		};
		try {
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
		} finally {
			delete PROVIDER_META['webdav'];
		}
	});

	test('the restore picker names Google Photos, which it used to show as a raw id', () => {
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
