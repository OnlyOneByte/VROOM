import type { StorageCatalogEntry } from '#lib/stores/provider-catalog.svelte.ts';

export const STORAGE_CATALOG: StorageCatalogEntry[] = [
	{
		id: 'google-drive',
		capability: 'storage',
		label: 'Google Drive',
		shortLabel: 'Google Drive',
		description: 'Store photos in Google Drive',
		scope: 'user',
		connect: 'oauth',
		fields: [],
		secrets: [],
		features: {
			photoOnly: false,
			backupSheets: true,
			defaultPhotoRootPath: 'Photos',
			defaultFolders: {
				vehicle_photos: 'Vehicle',
				expense_receipts: 'Receipts',
				insurance_docs: 'Insurance',
				odometer_readings: 'Odometer'
			}
		}
	},
	{
		id: 's3',
		capability: 'storage',
		label: 'S3 Compatible',
		shortLabel: 'S3 / B2 / R2',
		description: 'S3-compatible storage',
		scope: 'user',
		connect: 'form',
		fields: [
			{ key: 'endpoint', label: 'Endpoint', kind: 'url', required: true },
			{ key: 'bucket', label: 'Bucket', kind: 'text', required: true },
			{ key: 'region', label: 'Region', kind: 'text', required: true }
		],
		secrets: [
			{ key: 'accessKeyId', label: 'Access Key ID', required: true },
			{ key: 'secretAccessKey', label: 'Secret Access Key', required: true }
		],
		features: {
			photoOnly: false,
			backupSheets: false,
			defaultPhotoRootPath: 'vroom/photos',
			defaultFolders: {
				vehicle_photos: 'vehicles',
				expense_receipts: 'receipts',
				insurance_docs: 'insurance',
				odometer_readings: 'odometer'
			}
		}
	}
];

export const getStorageCatalog = () => Promise.resolve(STORAGE_CATALOG);
