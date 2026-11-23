import type { Component } from 'svelte';
import { Cloud, Database, Image } from '@lucide/svelte';
import type { PhotoCategory, CategorySetting } from '#lib/types/index.ts';
import type { GoogleOAuthReturn } from '#lib/components/settings/storage-provider/use-google-oauth.svelte.ts';
import GoogleDriveForm from '#lib/components/settings/storage-provider/form/GoogleDriveForm.svelte';
import S3Form from '#lib/components/settings/storage-provider/form/S3Form.svelte';

export interface ProviderConnection {
	ready: boolean;
	config: Record<string, unknown>;
	credentials: Record<string, unknown>;
	nonce?: string | undefined;
}

export interface ProviderFormProps {
	existingConfig: Record<string, unknown> | undefined;
	isEditMode: boolean;
	oauth: GoogleOAuthReturn;
	connection: ProviderConnection;
}

export interface ProviderFormMeta {
	component: Component<ProviderFormProps, Record<string, never>, 'connection'>;
	description: string;
	details?: (config: Record<string, unknown>) => { label: string; value: string }[];
}

export interface StorageProviderMeta {
	label: string;
	icon: Component<Record<string, unknown>>;
	form: ProviderFormMeta | null;
	option: { label: string; description: string } | null;
	defaultPhotoRootPath: string;
	supportsSheets: boolean;
	photoOnly: boolean;
}

export const PROVIDER_META: Record<string, StorageProviderMeta> = {
	'google-drive': {
		label: 'Google Drive',
		icon: Cloud,
		form: { component: GoogleDriveForm, description: 'Google Drive connection' },
		option: { label: 'Google Drive', description: 'Store photos in Google Drive' },
		defaultPhotoRootPath: 'Photos',
		supportsSheets: true,
		photoOnly: false
	},
	'google-photos': {
		label: 'Google Photos',
		icon: Image,
		form: null,
		option: null,
		defaultPhotoRootPath: 'photos',
		supportsSheets: false,
		photoOnly: true
	},
	s3: {
		label: 'S3 Compatible',
		icon: Database,
		form: {
			component: S3Form,
			description: 'S3-compatible storage credentials and endpoint',
			details: config =>
				(['endpoint', 'bucket', 'region'] as const).map(key => ({
					label: key.charAt(0).toUpperCase() + key.slice(1),
					value: (config[key] as string | undefined) ?? '—'
				}))
		},
		option: { label: 'S3 / B2 / R2', description: 'S3-compatible storage' },
		defaultPhotoRootPath: 'vroom/photos',
		supportsSheets: false,
		photoOnly: false
	}
};

export function providerMeta(providerType: string | null | undefined): StorageProviderMeta | null {
	return providerType && Object.hasOwn(PROVIDER_META, providerType)
		? (PROVIDER_META[providerType] ?? null)
		: null;
}

export function providerLabel(providerType: string): string {
	return providerMeta(providerType)?.label ?? providerType;
}

export function supportsZipBackup(providerType: string | null | undefined): boolean {
	return !!providerType && providerMeta(providerType)?.photoOnly !== true;
}

export const DEFAULT_FOLDER_SETTINGS: Record<PhotoCategory, CategorySetting> = {
	vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
	expense_receipts: { enabled: true, folderPath: 'Receipts' },
	insurance_docs: { enabled: true, folderPath: 'Insurance' },
	odometer_readings: { enabled: true, folderPath: 'Odometer' }
};

interface VlmProviderTypeOption {
	id: string;
	label: string;
	keyless: boolean;
	needsBaseUrl: boolean;
	defaultModel: string;
	defaultBaseUrl?: string;
}

export const VLM_PROVIDER_TYPES: VlmProviderTypeOption[] = [
	{
		id: 'openai-compatible',
		label: 'OpenAI-compatible',
		keyless: false,
		needsBaseUrl: true,
		defaultModel: 'gpt-4o-mini',
		defaultBaseUrl: 'https://api.openai.com/v1'
	},
	{
		id: 'anthropic',
		label: 'Anthropic (Claude)',
		keyless: false,
		needsBaseUrl: false,
		defaultModel: 'claude-opus-5-5'
	},
	{
		id: 'gemini',
		label: 'Google Gemini',
		keyless: false,
		needsBaseUrl: false,
		defaultModel: 'gemini-1.5-flash'
	},
	{
		id: 'ollama',
		label: 'Ollama (self-hosted)',
		keyless: true,
		needsBaseUrl: true,
		defaultModel: 'llava',
		defaultBaseUrl: 'http://localhost:11434/v1'
	}
];

export type ModelProviderTypeOption = VlmProviderTypeOption;

export const LLM_PROVIDER_TYPES: ModelProviderTypeOption[] = [
	{
		id: 'openai-compatible',
		label: 'OpenAI-compatible',
		keyless: false,
		needsBaseUrl: true,
		defaultModel: 'gpt-4o-mini',
		defaultBaseUrl: 'https://api.openai.com/v1'
	},
	{
		id: 'anthropic',
		label: 'Anthropic (Claude)',
		keyless: false,
		needsBaseUrl: false,
		defaultModel: 'claude-opus-5-5'
	},
	{
		id: 'gemini',
		label: 'Google Gemini',
		keyless: false,
		needsBaseUrl: false,
		defaultModel: 'gemini-1.5-flash'
	},
	{
		id: 'ollama',
		label: 'Ollama (self-hosted)',
		keyless: true,
		needsBaseUrl: true,
		defaultModel: 'llama3.1',
		defaultBaseUrl: 'http://localhost:11434/v1'
	}
];
