import type { Component } from 'svelte';
import { Cloud, Database, FlaskConical, Image } from '@lucide/svelte';
import type { PhotoCategory, CategorySetting } from '#lib/types/index.ts';
import type { GoogleOAuthReturn } from '#lib/components/settings/storage-provider/use-google-oauth.svelte.ts';
import GoogleDriveForm from '#lib/components/settings/storage-provider/form/GoogleDriveForm.svelte';
import S3Form from '#lib/components/settings/storage-provider/form/S3Form.svelte';
import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';

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
}

export interface ProviderUi {
	icon: Component<Record<string, unknown>>;
	form?: ProviderFormMeta;
	fallbackLabel?: string;
}

export const PROVIDER_UI: Record<string, ProviderUi> = {
	'google-drive': {
		icon: Cloud,
		form: { component: GoogleDriveForm, description: 'Google Drive connection' }
	},
	'google-photos': { icon: Image, fallbackLabel: 'Google Photos' },
	s3: {
		icon: Database,
		form: { component: S3Form, description: 'S3-compatible storage credentials and endpoint' }
	},
	fake: { icon: FlaskConical }
};

export function providerUi(providerType: string | null | undefined): ProviderUi | null {
	return providerType && Object.hasOwn(PROVIDER_UI, providerType)
		? (PROVIDER_UI[providerType] ?? null)
		: null;
}

export function providerLabel(providerType: string): string {
	return (
		providerCatalog.entry(providerType)?.label ??
		providerUi(providerType)?.fallbackLabel ??
		providerType
	);
}

export function supportsZipBackup(providerType: string | null | undefined): boolean {
	return providerCatalog.entry(providerType)?.features.photoOnly === false;
}

export function supportsSheetsBackup(providerType: string | null | undefined): boolean {
	return providerCatalog.entry(providerType)?.features.backupSheets === true;
}

export function providerDetails(
	providerType: string,
	config: Record<string, unknown>
): { label: string; value: string }[] {
	return (providerCatalog.entry(providerType)?.fields ?? []).map(field => ({
		label: field.label,
		value: (config[field.key] as string | undefined) ?? '—'
	}));
}

export function defaultFolderSettings(
	providerType: string | null | undefined
): Record<PhotoCategory, CategorySetting> {
	const folders = providerCatalog.entry(providerType)?.features.defaultFolders ?? {};
	return Object.fromEntries(
		Object.entries(folders).map(([category, folderPath]) => [
			category,
			{ enabled: true, folderPath }
		])
	) as Record<PhotoCategory, CategorySetting>;
}

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
