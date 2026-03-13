<script lang="ts">
	import { FolderOpen, ChevronDown } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Badge } from '$lib/components/ui/badge';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { PHOTO_CATEGORY_LABELS } from '$lib/constants/ui';
	import type { PhotoCategory, CategorySetting, UserProviderInfo } from '$lib/types';
	import { providerApi } from '$lib/services/provider-api';

	const CATEGORIES: PhotoCategory[] = [
		'vehicle_photos',
		'expense_receipts',
		'insurance_docs',
		'odometer_readings'
	];

	let {
		provider,
		categorySettings,
		defaultCategories = new Set<PhotoCategory>(),
		providerRootPath = '',
		onUpdate
	}: {
		provider: UserProviderInfo;
		categorySettings: Record<PhotoCategory, CategorySetting>;
		defaultCategories?: Set<PhotoCategory>;
		providerRootPath?: string;
		onUpdate: (_settings: Record<PhotoCategory, CategorySetting>) => void;
	} = $props();

	let rootPrefix = $derived(providerRootPath ? `${providerRootPath.replace(/\/+$/, '')}/` : '');

	// eslint-disable-next-line svelte/prefer-writable-derived -- rootPath is locally editable, reset on provider change
	let rootPath = $state((provider.config?.['photoRootPath'] as string) ?? 'Photos');
	let advancedOpen = $state(false);

	// Reset rootPath when provider changes
	$effect(() => {
		rootPath = (provider.config?.['photoRootPath'] as string) ?? 'Photos';
	});

	let saveTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleRootPathBlur() {
		if (provider.id === 'new') return;
		const originalPath = (provider.config?.['photoRootPath'] as string) ?? 'Photos';
		if (rootPath === originalPath) return;

		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			try {
				await providerApi.updateProvider(provider.id, {
					config: { ...provider.config, photoRootPath: rootPath }
				});
			} catch {
				rootPath = originalPath;
			}
		}, 300);
	}

	function handleCategoryToggle(category: PhotoCategory, checked: boolean) {
		const updated = { ...categorySettings };
		updated[category] = { ...updated[category], enabled: checked };
		onUpdate(updated);
	}

	function handleFolderPathChange(category: PhotoCategory, path: string) {
		const updated = { ...categorySettings };
		updated[category] = { ...updated[category], folderPath: path };
		onUpdate(updated);
	}

	let allEnabled = $derived(CATEGORIES.every(c => categorySettings[c]?.enabled));

	function handleToggleAll() {
		const newEnabled = !allEnabled;
		const updated = { ...categorySettings };
		for (const cat of CATEGORIES) {
			// Don't disable categories where this provider is the default
			if (!newEnabled && defaultCategories.has(cat)) continue;
			updated[cat] = { ...updated[cat], enabled: newEnabled };
		}
		onUpdate(updated);
	}

	let hasCustomPaths = $derived(
		CATEGORIES.some(c => {
			const setting = categorySettings[c];
			return setting && !setting.enabled;
		})
	);
</script>

<div class="space-y-4">
	<div class="flex items-center gap-2">
		<FolderOpen class="h-4 w-4 text-muted-foreground" />
		<span class="text-sm font-medium">Photo Storage Paths</span>
	</div>

	<!-- Root path -->
	<div class="space-y-2">
		<Label for="root-path" class="text-sm text-muted-foreground">Root Path</Label>
		<div
			class="flex items-center h-9 rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
		>
			{#if rootPrefix}
				<span class="pl-3 text-muted-foreground select-none shrink-0">{rootPrefix}</span>
			{/if}
			<input
				id="root-path"
				value={rootPath}
				oninput={e => {
					rootPath = e.currentTarget.value;
				}}
				onblur={handleRootPathBlur}
				placeholder="Photos"
				class="flex-1 bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground {rootPrefix
					? 'pl-0'
					: ''}"
			/>
		</div>
		<p class="text-xs text-muted-foreground">
			All photos will be stored under this path on the provider.
		</p>
	</div>

	<!-- Advanced: per-category paths -->
	<Collapsible.Root bind:open={advancedOpen}>
		<Collapsible.Trigger
			class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
		>
			<ChevronDown
				class="h-4 w-4 transition-transform duration-200 {advancedOpen ? 'rotate-180' : ''}"
			/>
			<span>Category paths & sync settings</span>
			{#if hasCustomPaths}
				<span class="text-xs text-chart-5">(some categories disabled)</span>
			{/if}
		</Collapsible.Trigger>
		<Collapsible.Content class="pt-3">
			<div class="space-y-3 rounded-lg border border-border p-3">
				<div class="flex items-center gap-2">
					<Checkbox checked={allEnabled} onCheckedChange={handleToggleAll} />
					<span class="text-sm text-muted-foreground">
						{allEnabled ? 'Disable All' : 'Enable All'}
					</span>
				</div>

				{#each CATEGORIES as category (category)}
					{@const setting = categorySettings[category]}
					{@const isDefault = defaultCategories.has(category)}
					<div class="flex items-center gap-3">
						<Checkbox
							checked={setting?.enabled ?? false}
							disabled={isDefault}
							onCheckedChange={checked => handleCategoryToggle(category, checked === true)}
						/>
						<div class="flex items-center gap-1.5 w-36 shrink-0">
							<span class="text-sm">{PHOTO_CATEGORY_LABELS[category]}</span>
							{#if isDefault}
								<Badge variant="outline" class="text-xs px-1.5 py-0">default</Badge>
							{/if}
						</div>
						<div
							class="flex items-center h-8 rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 flex-1 {!setting?.enabled
								? 'opacity-50'
								: ''}"
						>
							{#if rootPrefix}
								<span class="pl-2 text-muted-foreground select-none shrink-0 text-xs"
									>{rootPrefix}{rootPath}/</span
								>
							{/if}
							<input
								value={setting?.folderPath ?? ''}
								oninput={e => handleFolderPathChange(category, e.currentTarget.value)}
								placeholder="/folder"
								class="flex-1 bg-transparent px-2 py-1 outline-none text-sm placeholder:text-muted-foreground {rootPrefix
									? 'pl-0'
									: ''}"
								disabled={!setting?.enabled}
							/>
						</div>
					</div>
				{/each}

				{#if defaultCategories.size > 0}
					<p class="text-xs text-muted-foreground">
						Categories marked as default cannot be disabled. Change the default provider in settings
						first.
					</p>
				{/if}

				<p class="text-xs text-muted-foreground">
					Subfolder paths are relative to the root path above.
				</p>
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>
