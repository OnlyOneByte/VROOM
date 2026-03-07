<script lang="ts">
	import {
		Camera,
		Image,
		FileText,
		ShieldCheck,
		Gauge,
		ChevronDown,
		LoaderCircle,
		Cloud,
		Database,
		HardDrive
	} from '@lucide/svelte';
	import * as Select from '$lib/components/ui/select';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '$lib/components/ui/alert-dialog';
	import { providerApi } from '$lib/services/provider-api';
	import type { PhotoCategory, StorageConfig, UserProviderInfo } from '$lib/types';

	const CATEGORY_META: Record<PhotoCategory, { label: string; icon: typeof Camera }> = {
		vehicle_photos: { label: 'Vehicle Photos', icon: Image },
		expense_receipts: { label: 'Expense Receipts', icon: FileText },
		insurance_docs: { label: 'Insurance Docs', icon: ShieldCheck },
		odometer_readings: { label: 'Odometer Readings', icon: Gauge }
	};

	const CATEGORIES: PhotoCategory[] = [
		'vehicle_photos',
		'expense_receipts',
		'insurance_docs',
		'odometer_readings'
	];

	let {
		storageConfig,
		providers,
		onUpdate
	}: {
		storageConfig: StorageConfig;
		providers: UserProviderInfo[];
		onUpdate: (_config: StorageConfig) => void;
	} = $props();

	let showSyncGapDialog = $state(false);
	let checkingCategory = $state<PhotoCategory | null>(null);
	let advancedOpen = $state(false);
	let pendingChange = $state<{
		category: PhotoCategory;
		providerId: string;
		providerName: string;
		gap: number;
		total: number;
	} | null>(null);

	/** Check if all categories point to the same provider (or all null) */
	let uniformDefault = $derived.by(() => {
		const vals = CATEGORIES.map(c => storageConfig.defaults[c]);
		const first = vals[0];
		return vals.every(v => v === first) ? first : null;
	});

	/** Whether per-category overrides differ from each other */
	let hasPerCategoryOverrides = $derived.by(() => {
		const vals = CATEGORIES.map(c => storageConfig.defaults[c]);
		const first = vals[0];
		return !vals.every(v => v === first);
	});

	function getProviderIcon(providerType: string) {
		switch (providerType) {
			case 'google-drive':
				return Cloud;
			case 's3':
				return Database;
			default:
				return HardDrive;
		}
	}

	/** For a given category, return providers that have it enabled */
	function getEnabledProviders(category: PhotoCategory): UserProviderInfo[] {
		return providers.filter(p => {
			const cats = storageConfig.providerCategories[p.id];
			return cats?.[category]?.enabled === true;
		});
	}

	function applyChange(category: PhotoCategory, providerId: string) {
		const newDefaults = { ...storageConfig.defaults };
		newDefaults[category] = providerId === 'none' ? null : providerId;
		onUpdate({ ...storageConfig, defaults: newDefaults });
	}

	function applyAllCategories(providerId: string) {
		const value = providerId === 'none' ? null : providerId;
		const newDefaults = { ...storageConfig.defaults };
		for (const cat of CATEGORIES) {
			newDefaults[cat] = value;
		}
		onUpdate({ ...storageConfig, defaults: newDefaults });
	}

	async function handleGlobalChange(providerId: string) {
		if (providerId === 'none') {
			applyAllCategories(providerId);
			return;
		}

		// Check sync status for the first category as a representative
		checkingCategory = CATEGORIES[0] ?? 'vehicle_photos';
		try {
			const syncStatus = await providerApi.getSyncStatus(providerId);
			// Check if any category has unsynced photos
			let totalGap = 0;
			let totalPhotos = 0;
			for (const cat of CATEGORIES) {
				const status = syncStatus[cat];
				if (status) {
					totalGap += status.total - status.synced;
					totalPhotos += status.total;
				}
			}

			if (totalGap > 0) {
				const provider = providers.find(p => p.id === providerId);
				pendingChange = {
					category: CATEGORIES[0] ?? 'vehicle_photos',
					providerId,
					providerName: provider?.displayName ?? 'this provider',
					gap: totalGap,
					total: totalPhotos
				};
				showSyncGapDialog = true;
				return;
			}

			applyAllCategories(providerId);
		} catch {
			applyAllCategories(providerId);
		} finally {
			checkingCategory = null;
		}
	}

	async function handleCategoryChange(category: PhotoCategory, providerId: string) {
		if (providerId === 'none') {
			applyChange(category, providerId);
			return;
		}

		checkingCategory = category;
		try {
			const syncStatus = await providerApi.getSyncStatus(providerId);
			const categoryStatus = syncStatus[category];

			if (categoryStatus) {
				const gap = categoryStatus.total - categoryStatus.synced;
				if (gap > 0) {
					const provider = providers.find(p => p.id === providerId);
					pendingChange = {
						category,
						providerId,
						providerName: provider?.displayName ?? 'this provider',
						gap,
						total: categoryStatus.total
					};
					showSyncGapDialog = true;
					return;
				}
			}

			applyChange(category, providerId);
		} catch {
			applyChange(category, providerId);
		} finally {
			checkingCategory = null;
		}
	}

	function confirmChange() {
		if (pendingChange) {
			// If it was a global change (category is first), apply to all
			if (!advancedOpen) {
				applyAllCategories(pendingChange.providerId);
			} else {
				applyChange(pendingChange.category, pendingChange.providerId);
			}
			pendingChange = null;
		}
		showSyncGapDialog = false;
	}
</script>

<div class="space-y-4">
	<div class="flex items-center gap-2">
		<Camera class="h-4 w-4 text-muted-foreground" />
		<p class="text-sm font-medium">Default Photo Source</p>
	</div>

	<!-- Global default provider -->
	<div class="space-y-2">
		<div class="flex items-center justify-between gap-4">
			<p class="text-xs text-muted-foreground">
				Select a provider to serve all photo types from.
			</p>
			<div class="flex items-center gap-2">
				{#if checkingCategory && !advancedOpen}
					<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" />
				{/if}
				<Select.Root
					type="single"
					value={hasPerCategoryOverrides ? 'mixed' : (uniformDefault ?? 'none')}
					onValueChange={val => {
						if (val !== 'mixed') handleGlobalChange(val);
					}}
				>
					<Select.Trigger class="w-[220px]">
						{#if hasPerCategoryOverrides}
							<span class="text-muted-foreground">Mixed</span>
						{:else if uniformDefault}
							{@const provider = providers.find(p => p.id === uniformDefault)}
							<span class="truncate">
								{#if provider}
									{@const ProviderIcon = getProviderIcon(provider.providerType)}
									<ProviderIcon class="h-4 w-4 inline mr-1" />
									{provider.displayName}
								{:else}
									Not configured
								{/if}
							</span>
						{:else}
							<span class="text-muted-foreground">Not configured</span>
						{/if}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="none">Not configured</Select.Item>
						{#each providers as provider (provider.id)}
							{@const ProviderIcon = getProviderIcon(provider.providerType)}
							<Select.Item value={provider.id}>
								<ProviderIcon class="h-4 w-4 inline mr-1" />
								{provider.displayName}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</div>

	<!-- Per-category overrides -->
	<Collapsible.Root bind:open={advancedOpen}>
		<Collapsible.Trigger
			class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
		>
			<ChevronDown
				class="h-4 w-4 transition-transform duration-200 {advancedOpen ? 'rotate-180' : ''}"
			/>
			<span>Customize per photo type</span>
			{#if hasPerCategoryOverrides}
				<span class="text-xs text-chart-5">(custom)</span>
			{/if}
		</Collapsible.Trigger>
		<Collapsible.Content class="pt-3">
			<div class="space-y-3 rounded-lg border border-border p-3">
				{#each CATEGORIES as category (category)}
					{@const meta = CATEGORY_META[category]}
					{@const enabledProviders = getEnabledProviders(category)}
					{@const currentDefault = storageConfig.defaults[category]}
					{@const Icon = meta.icon}
					<div class="flex items-center justify-between gap-4">
						<div class="flex items-center gap-2 min-w-0">
							<Icon class="h-4 w-4 text-muted-foreground shrink-0" />
							<span class="text-sm">{meta.label}</span>
						</div>
						<div class="flex items-center gap-2">
							{#if checkingCategory === category}
								<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" />
							{/if}
							<Select.Root
								type="single"
								value={currentDefault ?? 'none'}
								onValueChange={val => handleCategoryChange(category, val)}
							>
								<Select.Trigger class="w-[200px]">
									{#if currentDefault}
										{@const provider = providers.find(p => p.id === currentDefault)}
										<span class="truncate">
											{#if provider}
												{@const ProviderIcon = getProviderIcon(provider.providerType)}
												<ProviderIcon class="h-4 w-4 inline mr-1" />
												{provider.displayName}
											{:else}
												Not configured
											{/if}
										</span>
									{:else}
										<span class="text-muted-foreground">Not configured</span>
									{/if}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="none">Not configured</Select.Item>
									{#each enabledProviders as provider (provider.id)}
										{@const ProviderIcon = getProviderIcon(provider.providerType)}
										<Select.Item value={provider.id}>
											<ProviderIcon class="h-4 w-4 inline mr-1" />
											{provider.displayName}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/each}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>

<AlertDialog bind:open={showSyncGapDialog}>
	<AlertDialogContent>
		<AlertDialogHeader>
			<AlertDialogTitle>Unsynced Photos</AlertDialogTitle>
			<AlertDialogDescription>
				{#if pendingChange}
					{pendingChange.gap} of {pendingChange.total} photos haven't synced to {pendingChange.providerName}
					yet. Switch anyway?
				{/if}
			</AlertDialogDescription>
		</AlertDialogHeader>
		<AlertDialogFooter>
			<AlertDialogCancel
				onclick={() => {
					pendingChange = null;
				}}>Cancel</AlertDialogCancel
			>
			<AlertDialogAction onclick={confirmChange}>Switch Anyway</AlertDialogAction>
		</AlertDialogFooter>
	</AlertDialogContent>
</AlertDialog>
