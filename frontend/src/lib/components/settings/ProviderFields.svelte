<script lang="ts" module>
	import type {
		ProviderFieldSpec,
		ProviderSecretSpec
	} from '#lib/stores/provider-catalog.svelte.ts';
	import { ApiError } from '#lib/utils/error-handling.ts';

	export interface ProviderFieldsSpec {
		fields: ProviderFieldSpec[];
		secrets: ProviderSecretSpec[];
	}

	export function initialFieldValues(
		spec: ProviderFieldsSpec,
		stored: Record<string, unknown> | undefined
	): Record<string, string> {
		return Object.fromEntries(
			spec.fields.map(field => {
				const value = stored ? stored[field.key] : field.default;
				const fits = typeof value === (field.kind === 'number' ? 'number' : 'string');
				return [field.key, fits ? String(value) : ''];
			})
		);
	}

	export function secretsNeeded(
		spec: ProviderFieldsSpec,
		values: Record<string, string>,
		stored: Record<string, unknown> | undefined
	): string[] {
		return spec.secrets
			.filter(secret => {
				if (!secret.required) return false;
				if (!stored) return true;
				return (secret.reenterWhenChanged ?? []).some(
					key => (values[key] ?? '') !== String(stored[key] ?? '')
				);
			})
			.map(secret => secret.key);
	}

	export function fieldsReady(
		spec: ProviderFieldsSpec,
		values: Record<string, string>,
		secretValues: Record<string, string>,
		stored: Record<string, unknown> | undefined
	): boolean {
		const filled = (value: string | undefined) => (value ?? '').trim().length > 0;
		return (
			spec.fields.every(field => !field.required || filled(values[field.key])) &&
			secretsNeeded(spec, values, stored).every(key => filled(secretValues[key]))
		);
	}

	export function fieldConfig(
		spec: ProviderFieldsSpec,
		values: Record<string, string>
	): Record<string, unknown> {
		return Object.fromEntries(
			spec.fields
				.filter(field => (values[field.key] ?? '').trim() !== '')
				.map(field => {
					const value = (values[field.key] ?? '').trim();
					return [field.key, field.kind === 'number' ? Number(value) : value];
				})
		);
	}

	export function fieldSecrets(
		spec: ProviderFieldsSpec,
		secretValues: Record<string, string>
	): Record<string, string> {
		const entered = spec.secrets.filter(secret => (secretValues[secret.key] ?? '').trim() !== '');
		if (entered.length === 0) return {};
		return Object.fromEntries(
			spec.secrets.map(secret => [secret.key, (secretValues[secret.key] ?? '').trim()])
		);
	}

	export function fieldErrorsFrom(
		error: unknown,
		spec: ProviderFieldsSpec
	): Record<string, string> {
		if (!(error instanceof ApiError)) return {};
		const issues = error.details?.['issues'];
		if (!Array.isArray(issues)) return {};
		const keys = new Set([...spec.fields, ...spec.secrets].map(f => f.key));
		const errors: Record<string, string> = {};
		for (const issue of issues as { path?: unknown[]; message?: unknown }[]) {
			const key = [...(issue.path ?? [])]
				.reverse()
				.find((part): part is string => typeof part === 'string');
			if (key && keys.has(key) && typeof issue.message === 'string' && !errors[key]) {
				errors[key] = issue.message;
			}
		}
		return errors;
	}
</script>

<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { FormFieldDescription, FormFieldError } from '#lib/components/ui/form-field/index.ts';

	let {
		idPrefix,
		spec,
		stored,
		values = $bindable(),
		secretValues = $bindable(),
		errors = {}
	}: {
		idPrefix: string;
		spec: ProviderFieldsSpec;
		stored: Record<string, unknown> | undefined;
		values: Record<string, string>;
		secretValues: Record<string, string>;
		errors?: Record<string, string>;
	} = $props();

	let needed = $derived(new Set(secretsNeeded(spec, values, stored)));

	function inputType(kind: ProviderFieldSpec['kind']): string {
		if (kind === 'url') return 'url';
		if (kind === 'number') return 'number';
		return 'text';
	}

	function describedBy(key: string, help: string | undefined): string | undefined {
		const ids = [help && `${idPrefix}-${key}-help`, errors[key] && `${idPrefix}-${key}-error`];
		return ids.filter(Boolean).join(' ') || undefined;
	}
</script>

<div class="space-y-4">
	{#each spec.fields as field (field.key)}
		{@const id = `${idPrefix}-${field.key}`}
		<div class="space-y-2">
			<div class="flex items-baseline gap-1">
				<Label for={id}>{field.label}</Label>
				{#if field.required}<span class="text-sm text-muted-foreground" aria-hidden="true">*</span>{/if}
			</div>
			{#if field.kind === 'select'}
				<Select.Root
					type="single"
					value={values[field.key] ?? ''}
					onValueChange={v => (values = { ...values, [field.key]: v ?? '' })}
				>
					<Select.Trigger
						{id}
						class="w-full"
						aria-invalid={!!errors[field.key]}
						aria-describedby={describedBy(field.key, field.help)}
					>
						{field.options?.find(o => o.value === values[field.key])?.label ??
							field.placeholder ??
							'Choose…'}
					</Select.Trigger>
					<Select.Content>
						{#each field.options ?? [] as option (option.value)}
							<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{:else}
				<Input
					{id}
					type={inputType(field.kind)}
					value={values[field.key] ?? ''}
					oninput={(e: Event) =>
						(values = { ...values, [field.key]: (e.currentTarget as HTMLInputElement).value })}
					placeholder={field.placeholder ??
						(field.default === undefined ? '' : String(field.default))}
					required={field.required}
					aria-invalid={!!errors[field.key]}
					aria-describedby={describedBy(field.key, field.help)}
				/>
			{/if}
			{#if field.help}
				<FormFieldDescription id="{id}-help" class="text-xs">{field.help}</FormFieldDescription>
			{/if}
			{#if errors[field.key]}
				<FormFieldError id="{id}-error">{errors[field.key]}</FormFieldError>
			{/if}
		</div>
	{/each}

	{#each spec.secrets as secret (secret.key)}
		{@const id = `${idPrefix}-${secret.key}`}
		{@const keepStored = !!stored && !needed.has(secret.key)}
		<div class="space-y-2">
			<div class="flex items-baseline gap-1">
				<Label for={id}>{secret.label}</Label>
				{#if needed.has(secret.key)}<span class="text-sm text-muted-foreground" aria-hidden="true">*</span>{/if}
			</div>
			<Input
				{id}
				type="password"
				autocomplete="off"
				value={secretValues[secret.key] ?? ''}
				oninput={(e: Event) =>
					(secretValues = {
						...secretValues,
						[secret.key]: (e.currentTarget as HTMLInputElement).value
					})}
				placeholder={keepStored ? 'Saved, leave blank to keep' : `Enter ${secret.label}`}
				required={needed.has(secret.key)}
				aria-invalid={!!errors[secret.key]}
				aria-describedby={errors[secret.key] ? `${id}-error` : undefined}
			/>
			{#if errors[secret.key]}
				<FormFieldError id="{id}-error">{errors[secret.key]}</FormFieldError>
			{/if}
		</div>
	{/each}
</div>
