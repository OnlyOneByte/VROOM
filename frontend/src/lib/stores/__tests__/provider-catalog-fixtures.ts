import type {
	CatalogEntry,
	ModelCapability,
	ModelCatalogEntry,
	StorageCatalogEntry
} from '#lib/stores/provider-catalog.svelte.ts';

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
		id: 'google-photos',
		capability: 'storage',
		label: 'Google Photos',
		shortLabel: 'Google Photos',
		description: 'Store photos in Google Photos',
		scope: 'user',
		connect: 'oauth',
		fields: [],
		secrets: [],
		features: {
			photoOnly: true,
			backupSheets: false,
			defaultPhotoRootPath: 'photos',
			defaultFolders: {
				vehicle_photos: 'vehicle-photos',
				expense_receipts: 'receipts',
				insurance_docs: 'insurance',
				odometer_readings: 'odometer'
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

function modelEntry(
	capability: ModelCapability,
	id: string,
	label: string,
	model: string,
	options: { baseUrl?: string; apiKey: boolean }
): ModelCatalogEntry {
	return {
		id,
		capability,
		label,
		shortLabel: label,
		description: label,
		scope: 'user',
		connect: 'form',
		fields: [
			{ key: 'model', label: 'Model', kind: 'text', required: true, default: model },
			...(options.baseUrl
				? [
						{
							key: 'baseUrl',
							label: 'Base URL',
							kind: 'url' as const,
							required: true,
							default: options.baseUrl
						}
					]
				: [])
		],
		secrets: options.apiKey ? [{ key: 'apiKey', label: 'API key', required: true }] : [],
		features: {}
	};
}

function modelEntries(capability: ModelCapability, ollamaModel: string): ModelCatalogEntry[] {
	return [
		modelEntry(capability, 'openai-compatible', 'OpenAI-compatible', 'gpt-4o-mini', {
			baseUrl: 'https://api.openai.com/v1',
			apiKey: true
		}),
		modelEntry(capability, 'anthropic', 'Anthropic (Claude)', 'claude-opus-5-5', { apiKey: true }),
		modelEntry(capability, 'gemini', 'Google Gemini', 'gemini-1.5-flash', { apiKey: true }),
		modelEntry(capability, 'ollama', 'Ollama (self-hosted)', ollamaModel, {
			baseUrl: 'http://localhost:11434/v1',
			apiKey: false
		})
	];
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
	...STORAGE_CATALOG,
	...modelEntries('ai.llm', 'llama3.1'),
	...modelEntries('ai.vision', 'llava')
];
