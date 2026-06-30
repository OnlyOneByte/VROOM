/**
 * Provider-related constants shared across settings components.
 */

import type { Component } from 'svelte';
import type { PhotoCategory, CategorySetting } from '$lib/types';

export interface ProviderTypeOption {
	id: string;
	label: string;
	description: string;
	icon: Component<Record<string, unknown>>;
	disabled: boolean;
}

/**
 * Default folder settings for new providers — all categories enabled with sensible paths.
 */
export const DEFAULT_FOLDER_SETTINGS: Record<PhotoCategory, CategorySetting> = {
	vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
	expense_receipts: { enabled: true, folderPath: 'Receipts' },
	insurance_docs: { enabled: true, folderPath: 'Insurance' },
	odometer_readings: { enabled: true, folderPath: 'Odometer' }
};

/**
 * VLM (vision-LLM) provider types for receipt parsing — the D1-ruled set (Angelo 2026-06-30):
 * OpenAI-compatible + Anthropic + Gemini + Ollama. Mirrors the backend SUPPORTED_PROVIDER_TYPES
 * vlm subset. `keyless` types (ollama) do not require an API key; `needsBaseUrl` types require one.
 * `defaultModel`/`defaultBaseUrl` pre-fill the form so the user only edits to change them.
 */
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

/**
 * Semantic alias — the same option shape backs both the VLM (receipt-parsing) and the LLM
 * (assistant) provider pickers, since both domains share the four model provider types.
 */
export type ModelProviderTypeOption = VlmProviderTypeOption;

/**
 * LLM (assistant) provider types — the D1-ruled set (Angelo 2026-06-30): the SAME four model
 * provider types as VLM (the backend `MODEL_PROVIDER_TYPES` serves both domains). The default
 * MODELS differ: a chat assistant needs a TOOL-CALLING text model, not a vision model — so
 * Ollama defaults to `llama3.1` (tool-call capable) rather than the VLM card's vision `llava`.
 */
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
