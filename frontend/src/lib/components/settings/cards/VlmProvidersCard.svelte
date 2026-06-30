<script lang="ts">
	/**
	 * VLM (receipt-parsing) provider settings card — vlm-receipt-parsing T5b.
	 *
	 * Lists the user's `domain:'vlm'` providers and offers an inline add/edit dialog. A VLM provider is
	 * just { providerType, apiKey, model, baseUrl? } — far simpler than a storage provider (no folder /
	 * backup config), so it lives in one self-contained card + dialog rather than a separate route.
	 *
	 * SECURITY: the API key field is WRITE-ONLY — the server strips credentials from every response, so
	 * we never display a stored key. On edit we leave the field blank and only send `credentials` when
	 * the user types a new key (an empty key on edit means "keep the existing one" — config-only PUT).
	 * The providerType picker offers the D1-ruled set (VLM_PROVIDER_TYPES). Ollama is keyless.
	 */
	import { onMount } from 'svelte';
	import { Sparkles, Plus, LoaderCircle, Pencil, Trash2 } from '@lucide/svelte';
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
	import { VLM_PROVIDER_TYPES, type VlmProviderTypeOption } from '$lib/constants/providers';
	import type { UserProviderInfo } from '$lib/types';

	let providers = $state<UserProviderInfo[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// --- Add/edit dialog state ---
	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null); // null = creating
	let formType = $state<string>('openai-compatible');
	let formDisplayName = $state('');
	let formApiKey = $state('');
	let formModel = $state('');
	let formBaseUrl = $state('');
	let isSaving = $state(false);

	// The D1 set is non-empty, so [0] is always defined; assert it for the type-checker
	// (noUncheckedIndexedAccess widens an array index to `T | undefined`).
	const FALLBACK_TYPE: VlmProviderTypeOption = VLM_PROVIDER_TYPES[0] as VlmProviderTypeOption;
	let selectedTypeOption = $derived<VlmProviderTypeOption>(
		VLM_PROVIDER_TYPES.find(t => t.id === formType) ?? FALLBACK_TYPE
	);
	let typeLabel = $derived(selectedTypeOption.label);

	async function loadData() {
		isLoading = true;
		try {
			providers = await providerApi.getProviders('vlm');
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load receipt-parsing providers';
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

	/** When the type changes (create flow), pre-fill model + baseUrl with that type's suggestions. */
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
					domain: 'vlm',
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
		return VLM_PROVIDER_TYPES.find(t => t.id === typeId)?.label ?? typeId;
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<Sparkles class="h-5 w-5 text-muted-foreground" />
			<CardTitle>Receipt Parsing (AI)</CardTitle>
		</div>
		<CardDescription>
			Connect a vision-AI provider to scan receipts into expense drafts. Bring your own key — your
			receipt is sent only to the provider you choose. For maximum privacy, self-host with Ollama.
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
					<Button variant="outline" size="sm" onclick={openCreate} data-testid="vlm-add-provider">
						<Plus class="h-4 w-4 mr-1" />
						Add Provider
					</Button>
				</div>

				{#if providers.length === 0}
					<div class="text-center py-6">
						<Sparkles class="h-10 w-10 text-muted-foreground mx-auto mb-2" />
						<p class="text-sm font-medium">No receipt-parsing provider configured</p>
						<p class="text-xs text-muted-foreground mt-1">
							Add one to scan receipts straight into an expense.
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
								data-testid="vlm-provider-row"
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
			<Dialog.Title>{editingId === null ? 'Add' : 'Edit'} receipt-parsing provider</Dialog.Title>
			<Dialog.Description>
				The API key is stored encrypted and never shown again. Your receipt image is sent only to
				this provider when you scan.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<div class="space-y-1.5">
				<Label for="vlm-type">Provider</Label>
				<Select.Root
					type="single"
					value={formType}
					onValueChange={onTypeChange}
					disabled={editingId !== null}
				>
					<Select.Trigger id="vlm-type" class="w-full" data-testid="vlm-type-trigger">
						{typeLabel}
					</Select.Trigger>
					<Select.Content>
						{#each VLM_PROVIDER_TYPES as t (t.id)}
							<Select.Item value={t.id} label={t.label}>{t.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="vlm-name">Display name</Label>
				<Input id="vlm-name" bind:value={formDisplayName} placeholder="My receipt parser" />
			</div>

			<div class="space-y-1.5">
				<Label for="vlm-model">Model</Label>
				<Input
					id="vlm-model"
					bind:value={formModel}
					placeholder={selectedTypeOption.defaultModel}
				/>
			</div>

			{#if selectedTypeOption.needsBaseUrl}
				<div class="space-y-1.5">
					<Label for="vlm-baseurl">Base URL</Label>
					<Input
						id="vlm-baseurl"
						bind:value={formBaseUrl}
						placeholder={selectedTypeOption.defaultBaseUrl}
					/>
				</div>
			{/if}

			{#if !selectedTypeOption.keyless}
				<div class="space-y-1.5">
					<Label for="vlm-key">API key</Label>
					<Input
						id="vlm-key"
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
			<Button onclick={handleSave} disabled={!canSave || isSaving} data-testid="vlm-save-provider">
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
