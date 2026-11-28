<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { focusFirstButton, focusFirstProblem, landOn } from '#lib/utils/focus.ts';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { Bot, Sparkles, Plus, LoaderCircle, Pencil, Trash2 } from '@lucide/svelte';
	import HowItWorks from '#lib/components/common/how-it-works.svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import {
		Card,
		CardAction,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { settingsApi } from '#lib/services/settings-api.ts';
	import ProviderHealth from '#lib/components/settings/ProviderHealth.svelte';
	import ProviderStatusBadge from '#lib/components/settings/ProviderStatusBadge.svelte';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { oldestFirst } from '#lib/utils/provider-order.ts';
	import ProviderFields, {
		fieldConfig,
		fieldErrorsFrom,
		fieldSecrets,
		fieldsReady,
		initialFieldValues
	} from '../ProviderFields.svelte';
	import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';
	import type { UserProviderInfo } from '#lib/types/index.ts';

	type ModelDomain = 'vlm' | 'llm';

	let { domain }: { domain: ModelDomain } = $props();

	const COPY = {
		vlm: {
			icon: Sparkles,
			title: 'Receipt scanning',
			description:
				'The built-in text reader reads receipts on your VROOM server, with no AI model and no key. For harder receipts, connect a vision-AI provider with your own key: your receipt is then sent only to the provider you choose. For maximum privacy, self-host with Ollama.',
			noun: 'receipt-scanning provider',
			addLabel: 'Add AI provider',
			summary: 'Scan receipts into expense drafts, built in or with your own AI key.',
			dialogNote:
				'The API key is stored encrypted and never shown again. Your receipt image is sent only to this provider when you scan.',
			namePlaceholder: 'My receipt parser',
			feature: 'Receipt scanning',
			useFor: 'receipt scanning',
			useForTitle: 'receipt scanning',
			loadError: "Couldn't load your receipt-scanning providers.",
			capability: 'ai.vision',
			anchor: 'receipt-scanning'
		},
		llm: {
			icon: Bot,
			title: 'Assistant',
			description:
				'Connect a chat-AI provider to ask questions about your vehicles and costs. Bring your own key — your questions are sent only to the provider you choose. The assistant is read-only and can never change your data. For maximum privacy, self-host with Ollama.',
			noun: 'assistant provider',
			addLabel: 'Add AI assistant',
			summary: 'Ask an AI about your vehicles and costs with your own key.',
			dialogNote:
				'The API key is stored encrypted and never shown again. Your questions are sent only to this provider when you chat.',
			namePlaceholder: 'My assistant',
			feature: 'The assistant',
			useFor: 'the assistant',
			useForTitle: 'the assistant',
			loadError: "Couldn't load your assistant providers.",
			capability: 'ai.llm',
			anchor: 'assistant-providers'
		}
	} as const;

	let copy = $derived(COPY[domain]);
	let providerTypes = $derived(
		providerCatalog.models(copy.capability).filter(t => t.scope !== 'builtin')
	);
	let builtins = $derived(
		providerCatalog.models(copy.capability).filter(t => t.scope === 'builtin')
	);
	const builtinId = (entry: { id: string }) => `builtin:${entry.id}`;
	let Icon = $derived(copy.icon);

	let providers = $state<UserProviderInfo[]>([]);
	let savedDefaultId = $state<string | null>(null);
	let defaultsUnknown = $state(false);
	let savingDefaultId = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let content = $state<HTMLElement | null>(null);

	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null);
	let editingConfig = $state<Record<string, unknown> | undefined>(undefined);
	let editingSecrets = $state<string[] | undefined>(undefined);
	let formType = $state('');
	let formDisplayName = $state('');
	let fieldValues = $state<Record<string, string>>({});
	let secretValues = $state<Record<string, string>>({});
	let fieldErrors = $state<Record<string, string>>({});
	let dialogFields = $state<HTMLElement | null>(null);
	let isSaving = $state(false);

	onMount(() => trackPendingSave(() => isSaving));
	let deleteConfirmOpen = $state(false);
	let deletingProvider = $state<UserProviderInfo | null>(null);
	let deletingProviderLosesKey = $derived(
		deletingProvider !== null &&
			(providerTypes.find(t => t.id === deletingProvider?.providerType)?.secrets.length ?? 1) > 0
	);

	let usable = $derived(providers.filter(p => p.status !== 'disabled'));
	let choiceCount = $derived(usable.length + builtins.length);
	let defaultId = $derived(
		builtins.map(builtinId).find(id => id === savedDefaultId) ??
			usable.find(p => p.id === savedDefaultId)?.id ??
			[...usable].sort(oldestFirst)[0]?.id ??
			(builtins[0] ? builtinId(builtins[0]) : null)
	);

	async function useAsDefault(p: { id: string; displayName: string }) {
		if (savingDefaultId) return;
		savingDefaultId = p.id;
		try {
			await settingsApi.updateSettings({ providerDefaults: { [copy.capability]: p.id } });
			savedDefaultId = p.id;
			defaultsUnknown = false;
			appStore.showSuccess(`${copy.feature} now uses ${p.displayName}.`);
		} catch (e) {
			appStore.showError(`Couldn't change the provider. ${userFacingErrorMessage(e)}`);
		} finally {
			savingDefaultId = null;
		}
	}

	function replaceProvider(updated: UserProviderInfo) {
		providers = providers.map(p => (p.id === updated.id ? updated : p));
	}

	let selectedEntry = $derived(providerTypes.find(t => t.id === formType) ?? providerTypes[0]);
	let typeLabel = $derived(selectedEntry?.label ?? '');

	async function loadData() {
		isLoading = true;
		try {
			const [list, , settings] = await Promise.all([
				providerApi.getProviders(domain),
				providerCatalog.ensureLoaded(),
				settingsApi.getSettings().catch(() => null)
			]);
			providers = list;
			defaultsUnknown = settings === null;
			savedDefaultId = settings?.providerDefaults?.[copy.capability] ?? null;
			error = null;
		} catch (e) {
			error = `${copy.loadError} ${userFacingErrorMessage(e)}`;
		} finally {
			isLoading = false;
		}
	}

	let stopLanding: (() => void) | undefined;
	onDestroy(() => stopLanding?.());
	onMount(async () => {
		await loadData();
		if (location.hash !== `#${copy.anchor}`) return;
		await tick();
		const card = document.getElementById(copy.anchor);
		if (card) stopLanding = landOn(card);
	});

	async function retryLoad() {
		await loadData();
		await tick();
		focusFirstButton(
			error ? content?.querySelector(`[data-testid="${domain}-provider-error"]`) : content
		);
	}

	function openCreate() {
		editingId = null;
		editingConfig = undefined;
		editingSecrets = undefined;
		formType = providerTypes[0]?.id ?? '';
		resetFields();
		formDisplayName = '';
		dialogOpen = true;
	}

	function openEdit(p: UserProviderInfo) {
		editingId = p.id;
		editingConfig = p.config;
		editingSecrets = p.secretsSet;
		formType = p.providerType;
		formDisplayName = p.displayName;
		resetFields();
		dialogOpen = true;
	}

	function resetFields() {
		fieldValues = selectedEntry ? initialFieldValues(selectedEntry, editingConfig) : {};
		secretValues = {};
		fieldErrors = {};
	}

	function onTypeChange(v: string | undefined) {
		if (!v) return;
		formType = v;
		if (editingId === null) resetFields();
	}

	let canSave = $derived(
		formDisplayName.trim().length > 0 &&
			!!selectedEntry &&
			fieldsReady(selectedEntry, fieldValues, secretValues, editingConfig, editingSecrets)
	);

	async function handleSave() {
		if (!canSave || isSaving || !selectedEntry) return;
		const entry = selectedEntry;
		isSaving = true;
		try {
			const config = fieldConfig(entry, fieldValues);
			const credentials = fieldSecrets(entry, secretValues);

			if (editingId === null) {
				await providerApi.createProvider({
					domain,
					providerType: formType,
					displayName: formDisplayName.trim(),
					credentials,
					config
				});
				appStore.showSuccess(`${formDisplayName.trim()} added`);
			} else {
				await providerApi.updateProvider(editingId, {
					displayName: formDisplayName.trim(),
					config,
					...(Object.keys(credentials).length > 0 && { credentials })
				});
				appStore.showSuccess(`${formDisplayName.trim()} updated`);
			}
			dialogOpen = false;
			await loadData();
		} catch (e) {
			fieldErrors = fieldErrorsFrom(e, entry);
			if (Object.keys(fieldErrors).length > 0) void focusFirstProblem(dialogFields);
			appStore.showError(`Couldn't save the provider. ${userFacingErrorMessage(e)}`);
		} finally {
			isSaving = false;
		}
	}

	function confirmDelete(p: UserProviderInfo) {
		deletingProvider = p;
		deleteConfirmOpen = true;
	}

	async function handleDelete() {
		const p = deletingProvider;
		if (!p) return;
		try {
			await providerApi.deleteProvider(p.id);
			appStore.showSuccess(`${p.displayName} removed`);
		} catch (error) {
			appStore.showError(`Couldn't delete the provider. ${userFacingErrorMessage(error)}`);
			throw error;
		}
		await loadData();
	}

	function labelFor(typeId: string): string {
		return providerTypes.find(t => t.id === typeId)?.label ?? typeId;
	}
</script>

{#snippet defaultControl(provider: { id: string; displayName: string })}
	{#if defaultsUnknown}
		<p class="text-xs text-muted-foreground">Couldn't load which provider {copy.useFor} uses.</p>
	{:else if provider.id === defaultId}
		<p class="text-xs text-muted-foreground">Used for {copy.useFor}</p>
	{:else}
		<Button
			variant="outline"
			aria-disabled={savingDefaultId !== null}
			onclick={() => useAsDefault(provider)}
		>
			{#if savingDefaultId === provider.id}
				<LoaderCircle class="animate-spin" aria-hidden="true" />
			{/if}
			Use for {copy.useForTitle}
		</Button>
	{/if}
{/snippet}

<Card
	variant="section"
	id={copy.anchor}
	tabindex={-1}
	role="region"
	aria-labelledby="{copy.anchor}-title"
	class="outline-none"
	bind:ref={content}
>
	<CardHeader>
		<CardTitle level={2} id="{copy.anchor}-title" class="text-base">{copy.title}</CardTitle>
		<CardAction>
			<Button onclick={openCreate} data-testid="{domain}-add-provider">
				<Plus aria-hidden="true" />
				{copy.addLabel}
			</Button>
		</CardAction>
		<CardDescription>{copy.summary}</CardDescription>
		<HowItWorks>
			<p class="text-sm text-muted-foreground">{copy.description}</p>
		</HowItWorks>
	</CardHeader>
	<CardContent>
		{#if isLoading}
			<div class="flex items-center justify-center py-8" role="status">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
				<span class="sr-only">Loading your {copy.noun}s</span>
			</div>
		{:else if error}
			<div class="space-y-3" data-testid="{domain}-provider-error">
				<p class="text-sm text-destructive" role="alert">{error}</p>
				<Button variant="outline" onclick={retryLoad}>Retry</Button>
			</div>
		{:else if providers.length === 0 && builtins.length === 0}
			<p class="text-sm text-muted-foreground">No {copy.noun} connected</p>
		{:else}
			<div class="divide-y">
				{#each builtins as entry (entry.id)}
					{@const id = builtinId(entry)}
					<div class="space-y-3 py-3 first:pt-0" data-testid="{domain}-builtin-row">
						<div class="flex min-w-0 items-center gap-3">
							<div
								class="flex size-11 shrink-0 items-center justify-center rounded-(--r-md) border border-border bg-sunk"
								aria-hidden="true"
							>
								<Icon class="size-5 text-foreground" />
							</div>
							<div class="min-w-0">
								<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
									<p class="font-medium">{entry.label}</p>
									<Badge variant="outline" class="shrink-0 text-muted-foreground">Built in</Badge>
								</div>
								<p class="text-sm text-muted-foreground">{entry.description}</p>
							</div>
						</div>
						{#if choiceCount > 1}
							<div class="sm:pl-14">
								{@render defaultControl({ id, displayName: entry.label })}
							</div>
						{/if}
					</div>
				{/each}
				{#each providers as provider (provider.id)}
					<div class="space-y-3 py-3 first:pt-0" data-testid="{domain}-provider-row">
						<div class="flex items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-3">
								<div
									class="flex size-11 shrink-0 items-center justify-center rounded-(--r-md) border border-border bg-sunk"
									aria-hidden="true"
								>
									<Icon class="size-5 text-foreground" />
								</div>
								<div class="min-w-0">
									<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
										<p class="font-medium break-words">{provider.displayName}</p>
										<ProviderStatusBadge status={provider.status} />
									</div>
									<p class="text-sm break-words text-muted-foreground">
										{labelFor(provider.providerType)}
										{#if typeof provider.config['model'] === 'string'}
											· {provider.config['model']}
										{/if}
									</p>
								</div>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<Button
									variant="ghost"
									size="icon"
									class="size-10"
									aria-label="Edit {provider.displayName}"
									onclick={() => openEdit(provider)}
								>
									<Pencil class="h-4 w-4" aria-hidden="true" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									class="size-10"
									aria-label="Delete {provider.displayName}"
									onclick={() => confirmDelete(provider)}
								>
									<Trash2 class="h-4 w-4 text-destructive" aria-hidden="true" />
								</Button>
							</div>
						</div>
						<div class="space-y-3 sm:pl-14">
							{#if choiceCount > 1 && provider.status !== 'disabled'}
								{@render defaultControl(provider)}
							{/if}
							<ProviderHealth {provider} onFix={openEdit} onUpdated={replaceProvider} />
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editingId === null ? 'Add' : 'Edit'} {copy.noun}</Dialog.Title>
			<Dialog.Description>{copy.dialogNote}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2" bind:this={dialogFields}>
			<div class="space-y-2">
				<Label for="{domain}-type">Provider</Label>
				<Select.Root
					type="single"
					value={formType}
					onValueChange={onTypeChange}
					disabled={editingId !== null}
				>
					<Select.Trigger id="{domain}-type" class="w-full" data-testid="{domain}-type-trigger">
						{typeLabel}
					</Select.Trigger>
					<Select.Content>
						{#each providerTypes as t (t.id)}
							<Select.Item value={t.id} label={t.label}>{t.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-2">
				<div class="flex items-baseline gap-1">
					<Label for="{domain}-name">Display name</Label>
					<span class="text-sm text-muted-foreground" aria-hidden="true">*</span>
				</div>
				<Input
					id="{domain}-name"
					bind:value={formDisplayName}
					placeholder={copy.namePlaceholder}
					required
				/>
			</div>

			{#if selectedEntry}
				<ProviderFields
					idPrefix={domain}
					spec={selectedEntry}
					stored={editingConfig}
					savedSecrets={editingSecrets}
					bind:values={fieldValues}
					bind:secretValues
					errors={fieldErrors}
				/>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)} disabled={isSaving}>
				Cancel
			</Button>
			<Button
				onclick={handleSave}
				disabled={!canSave || isSaving}
				data-testid="{domain}-save-provider"
			>
				{#if isSaving}
					<LoaderCircle class="animate-spin" aria-hidden="true" />
					Saving…
				{:else}
					{editingId === null ? 'Add provider' : 'Save'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Delete {copy.noun}?"
	description={deletingProvider
		? `"${deletingProvider.displayName}"${deletingProviderLosesKey ? ' and its saved API key' : ''} will be permanently deleted. ${copy.feature} stops using it. This cannot be undone.`
		: ''}
	onConfirm={handleDelete}
/>
