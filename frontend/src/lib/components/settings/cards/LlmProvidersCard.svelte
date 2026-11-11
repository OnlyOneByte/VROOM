<script lang="ts">
	/** LLM provider settings: mirrors the VLM card for the llm domain. The API key is write-only; blank on edit keeps the stored key. */
	import { onMount } from 'svelte';
	import { Bot, Plus, LoaderCircle, Pencil, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { providerApi } from '$lib/services/provider-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { LLM_PROVIDER_TYPES, type ModelProviderTypeOption } from '$lib/constants/providers';
	import type { UserProviderInfo } from '$lib/types';

	let providers = $state<UserProviderInfo[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null); // null = creating
	let formType = $state<string>('openai-compatible');
	let formDisplayName = $state('');
	let formApiKey = $state('');
	let formModel = $state('');
	let formBaseUrl = $state('');
	let isSaving = $state(false);

	// The provider type set is non-empty, so [0] is defined; the assertion satisfies noUncheckedIndexedAccess.
	const FALLBACK_TYPE: ModelProviderTypeOption = LLM_PROVIDER_TYPES[0] as ModelProviderTypeOption;
	let selectedTypeOption = $derived<ModelProviderTypeOption>(
		LLM_PROVIDER_TYPES.find(t => t.id === formType) ?? FALLBACK_TYPE
	);
	let typeLabel = $derived(selectedTypeOption.label);

	async function loadData() {
		isLoading = true;
		try {
			providers = await providerApi.getProviders('llm');
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load assistant providers';
		} finally {
			isLoading = false;
		}
	}

	onMount(loadData);

	function openCreate() {
		editingId = null;
		formType = 'openai-compatible';
		applyTypeDefaults();
		formDisplayName = '';
		formApiKey = '';
		dialogOpen = true;
	}

	function openEdit(p: UserProviderInfo) {
		editingId = p.id;
		formType = p.providerType;
		formDisplayName = p.displayName;
		formApiKey = ''; // write-only — never pre-filled (server strips credentials)
		formModel = typeof p.config['model'] === 'string' ? p.config['model'] : '';
		formBaseUrl = typeof p.config['baseUrl'] === 'string' ? p.config['baseUrl'] : '';
		dialogOpen = true;
	}

	function applyTypeDefaults() {
		formModel = selectedTypeOption.defaultModel;
		formBaseUrl = selectedTypeOption.defaultBaseUrl ?? '';
	}

	function onTypeChange(v: string | undefined) {
		if (!v) return;
		formType = v;
		// Only re-seed defaults on the CREATE flow — never clobber an existing provider's values on edit.
		if (editingId === null) applyTypeDefaults();
	}

	let canSave = $derived(
		formDisplayName.trim().length > 0 &&
			formModel.trim().length > 0 &&
			// non-ollama create needs a key; edit may keep the existing key (blank allowed)
			(selectedTypeOption.keyless || editingId !== null || formApiKey.trim().length > 0) &&
			// self-hosted / compatible needs a base URL
			(!selectedTypeOption.needsBaseUrl || formBaseUrl.trim().length > 0)
	);

	async function handleSave() {
		if (!canSave || isSaving) return;
		isSaving = true;
		try {
			const config: Record<string, unknown> = { model: formModel.trim() };
			if (selectedTypeOption.needsBaseUrl) config['baseUrl'] = formBaseUrl.trim();

			if (editingId === null) {
				await providerApi.createProvider({
					domain: 'llm',
					providerType: formType,
					displayName: formDisplayName.trim(),
					credentials: formApiKey.trim() ? { apiKey: formApiKey.trim() } : {},
					config
				});
				appStore.showSuccess(`${formDisplayName.trim()} added`);
			} else {
				// Only send credentials when the user typed a new key — a blank key keeps the stored one
				// (the backend's config-only PUT does not demand the apiKey be re-sent).
				await providerApi.updateProvider(editingId, {
					displayName: formDisplayName.trim(),
					config,
					...(formApiKey.trim() ? { credentials: { apiKey: formApiKey.trim() } } : {})
				});
				appStore.showSuccess(`${formDisplayName.trim()} updated`);
			}
			dialogOpen = false;
			await loadData();
		} catch (e) {
			appStore.showError(e instanceof Error ? e.message : 'Failed to save provider');
		} finally {
			isSaving = false;
		}
	}

	async function handleDelete(p: UserProviderInfo) {
		try {
			await providerApi.deleteProvider(p.id);
			appStore.showSuccess(`${p.displayName} removed`);
			await loadData();
		} catch {
			appStore.showError('Failed to delete provider');
		}
	}

	function labelFor(typeId: string): string {
		return LLM_PROVIDER_TYPES.find(t => t.id === typeId)?.label ?? typeId;
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<Bot class="h-5 w-5 text-muted-foreground" />
			<CardTitle>Assistant (AI)</CardTitle>
		</div>
		<CardDescription>
			Connect a chat-AI provider to ask questions about your vehicles and costs. Bring your own key
			— your questions are sent only to the provider you choose. The assistant is read-only and can
			never change your data. For maximum privacy, self-host with Ollama.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<p class="text-sm text-destructive">{error}</p>
		{:else}
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium">Providers</p>
					<Button variant="outline" size="sm" onclick={openCreate} data-testid="llm-add-provider">
						<Plus class="h-4 w-4 mr-1" />
						Add Provider
					</Button>
				</div>

				{#if providers.length === 0}
					<div class="text-center py-6">
						<Bot class="h-10 w-10 text-muted-foreground mx-auto mb-2" />
						<p class="text-sm font-medium">No assistant provider configured</p>
						<p class="text-xs text-muted-foreground mt-1">
							Add one to chat with an AI about your vehicles and costs.
						</p>
						<Button variant="outline" size="sm" class="mt-3" onclick={openCreate}>
							<Plus class="h-4 w-4 mr-1" />
							Add Provider
						</Button>
					</div>
				{:else}
					<div class="space-y-2">
						{#each providers as provider (provider.id)}
							<div
								class="flex items-center justify-between rounded-lg border p-3"
								data-testid="llm-provider-row"
							>
								<div class="min-w-0">
									<p class="text-sm font-medium truncate">{provider.displayName}</p>
									<p class="text-xs text-muted-foreground truncate">
										{labelFor(provider.providerType)}
										{#if typeof provider.config['model'] === 'string'}
											· {provider.config['model']}
										{/if}
									</p>
								</div>
								<div class="flex items-center gap-1 shrink-0">
									<Button
										variant="ghost"
										size="icon"
										aria-label="Edit {provider.displayName}"
										onclick={() => openEdit(provider)}
									>
										<Pencil class="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Delete {provider.displayName}"
										onclick={() => handleDelete(provider)}
									>
										<Trash2 class="h-4 w-4 text-destructive" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editingId === null ? 'Add' : 'Edit'} assistant provider</Dialog.Title>
			<Dialog.Description>
				The API key is stored encrypted and never shown again. Your questions are sent only to this
				provider when you chat.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<div class="space-y-1.5">
				<Label for="llm-type">Provider</Label>
				<Select.Root
					type="single"
					value={formType}
					onValueChange={onTypeChange}
					disabled={editingId !== null}
				>
					<Select.Trigger id="llm-type" class="w-full" data-testid="llm-type-trigger">
						{typeLabel}
					</Select.Trigger>
					<Select.Content>
						{#each LLM_PROVIDER_TYPES as t (t.id)}
							<Select.Item value={t.id} label={t.label}>{t.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="llm-name">Display name</Label>
				<Input id="llm-name" bind:value={formDisplayName} placeholder="My assistant" />
			</div>

			<div class="space-y-1.5">
				<Label for="llm-model">Model</Label>
				<Input
					id="llm-model"
					bind:value={formModel}
					placeholder={selectedTypeOption.defaultModel}
				/>
			</div>

			{#if selectedTypeOption.needsBaseUrl}
				<div class="space-y-1.5">
					<Label for="llm-baseurl">Base URL</Label>
					<Input
						id="llm-baseurl"
						bind:value={formBaseUrl}
						placeholder={selectedTypeOption.defaultBaseUrl}
					/>
				</div>
			{/if}

			{#if !selectedTypeOption.keyless}
				<div class="space-y-1.5">
					<Label for="llm-key">API key</Label>
					<Input
						id="llm-key"
						type="password"
						bind:value={formApiKey}
						placeholder={editingId === null ? 'sk-…' : 'Leave blank to keep current key'}
						autocomplete="off"
					/>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)} disabled={isSaving}>
				Cancel
			</Button>
			<Button onclick={handleSave} disabled={!canSave || isSaving} data-testid="llm-save-provider">
				{#if isSaving}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Saving...
				{:else}
					{editingId === null ? 'Add provider' : 'Save'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
