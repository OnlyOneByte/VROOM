import type { Component } from 'svelte';
import type { PhotoCategory, CategorySetting } from '$lib/types';

export interface ProviderTypeOption {
	id: string;
	label: string;
	description: string;
	icon: Component<Record<string, unknown>>;
	disabled: boolean;
}

export const DEFAULT_FOLDER_SETTINGS: Record<PhotoCategory, CategorySetting> = {
	vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
	expense_receipts: { enabled: true, folderPath: 'Receipts' },
	insurance_docs: { enabled: true, folderPath: 'Insurance' },
	odometer_readings: { enabled: true, folderPath: 'Odometer' }
};

export interface VlmProviderTypeOption {
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
		defaultModel: 'claude-3-5-sonnet-latest'
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
		defaultModel: 'claude-3-5-sonnet-latest'
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
