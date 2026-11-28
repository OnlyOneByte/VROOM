<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as Collapsible from '#lib/components/ui/collapsible/index.ts';
	import { PHOTO_CATEGORY_LABELS } from '#lib/constants/ui.ts';
	import type { PhotoCategory, CategorySetting } from '#lib/types/index.ts';

	const CATEGORIES: PhotoCategory[] = [
		'vehicle_photos',
		'expense_receipts',
		'insurance_docs',
		'odometer_readings'
	];

	let {
		photoRootPath = $bindable('Photos'),
		categorySettings,
		defaultCategories = new Set<PhotoCategory>(),
		providerRootPath = '',
		onUpdate
	}: {
		photoRootPath: string;
		categorySettings: Record<PhotoCategory, CategorySetting>;
		defaultCategories?: Set<PhotoCategory>;
		providerRootPath?: string;
		onUpdate: (_settings: Record<PhotoCategory, CategorySetting>) => void;
	} = $props();

	const uid = $props.id();

	let rootPrefix = $derived(providerRootPath ? `${providerRootPath.replace(/\/+$/, '')}/` : '');

	let advancedOpen = $state(false);

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
	<div class="space-y-2">
		<Label for="root-path" class="text-sm">Photo folder</Label>
		<div
			class="flex h-11.5 items-center rounded-(--r-md) border-[1.5px] border-border-strong bg-surface text-base focus-within:border-foreground focus-within:ring-[3px] focus-within:ring-ring/50 md:text-sm"
		>
			{#if rootPrefix}
				<span class="pl-3.5 text-muted-foreground select-none shrink-0">{rootPrefix}</span>
			{/if}
			<input
				id="root-path"
				bind:value={photoRootPath}
				placeholder="Photos"
				class="min-w-0 flex-1 bg-transparent px-3.5 py-1 outline-none placeholder:text-muted-foreground {rootPrefix
					? 'pl-0'
					: ''}"
			/>
		</div>
		<p class="text-xs text-muted-foreground">
			All photos will be stored under this path in this storage.
		</p>
	</div>

	<Collapsible.Root bind:open={advancedOpen}>
		<Collapsible.Trigger
			class="flex min-h-10 w-full items-center gap-x-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<ChevronDown
				class="h-4 w-4 shrink-0 transition-transform duration-200 {advancedOpen
					? 'rotate-180'
					: ''}"
			/>
			<span class="min-w-0">
				<span>Category paths & sync settings</span>
				{#if hasCustomPaths}
					<span class="whitespace-nowrap text-xs text-warning">(some categories disabled)</span>
				{/if}
			</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="pt-3">
			<div class="space-y-2 rounded-lg border border-border p-3">
				<div class="flex min-h-10 items-center gap-2">
					<Checkbox id="{uid}-all" checked={allEnabled} onCheckedChange={handleToggleAll} />
					<label for="{uid}-all" class="text-sm text-muted-foreground">
						{allEnabled ? 'Disable all' : 'Enable all'}
					</label>
				</div>

				{#each CATEGORIES as category (category)}
					{@const setting = categorySettings[category]}
					{@const isDefault = defaultCategories.has(category)}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="photo-folder-row">
						<Checkbox
							id="{uid}-{category}"
							checked={setting?.enabled ?? false}
							disabled={isDefault}
							onCheckedChange={checked => handleCategoryToggle(category, checked === true)}
						/>
						<div class="flex min-h-10 flex-1 items-center gap-1.5 sm:w-36 sm:flex-none sm:shrink-0">
							<label for="{uid}-{category}" class="text-sm">
								{PHOTO_CATEGORY_LABELS[category]}
							</label>
							{#if isDefault}
								<Badge variant="outline" class="text-xs px-1.5 py-0">default</Badge>
							{/if}
						</div>
						<div
							class="flex items-center h-10 min-w-0 basis-full sm:basis-0 rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 flex-1 {!setting?.enabled
								? 'opacity-50'
								: ''}"
						>
							{#if rootPrefix}
								<span class="pl-2 text-muted-foreground select-none shrink-0 text-xs">
									{rootPrefix}{photoRootPath}/
								</span>
							{/if}
							<input
								value={setting?.folderPath ?? ''}
								oninput={e => handleFolderPathChange(category, e.currentTarget.value)}
								placeholder="/folder"
								aria-label="{PHOTO_CATEGORY_LABELS[category]} folder path"
								class="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none text-sm placeholder:text-muted-foreground {rootPrefix
									? 'pl-0'
									: ''}"
								disabled={!setting?.enabled}
							/>
						</div>
					</div>
				{/each}

				{#if defaultCategories.size > 0}
					<p class="text-xs text-muted-foreground">
						Categories marked as default cannot be disabled. Change the default photo source first.
					</p>
				{/if}

				<p class="text-xs text-muted-foreground">
					Subfolder paths are relative to the root path above.
				</p>
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>
