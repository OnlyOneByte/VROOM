<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronDown,
		ChevronUp,
		Pencil,
		Trash2,
		Cloud,
		RefreshCw,
		LoaderCircle
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Progress } from '#lib/components/ui/progress/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { settingsApi } from '#lib/services/settings-api.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import ProviderHealth from '#lib/components/settings/ProviderHealth.svelte';
	import ProviderStatusBadge from '#lib/components/settings/ProviderStatusBadge.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { PHOTO_CATEGORY_LABELS } from '#lib/constants/ui.ts';
	import {
		providerDetails,
		providerLabel,
		providerUi,
		supportsSheetsBackup,
		supportsZipBackup as providerSupportsZipBackup
	} from '#lib/constants/providers.ts';
	import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';
	import type { PhotoCategory, CategorySetting, UserProviderInfo } from '#lib/types/index.ts';

	let {
		provider,
		categorySettings,
		backupEnabled = false,
		sheetsSyncEnabled = false,
		lastBackupAt,
		onEdit,
		onDelete,
		onBackupToggle,
		onSheetsSyncToggle,
		onUpdated,
		onReconnect
	}: {
		provider: UserProviderInfo;
		categorySettings: Record<PhotoCategory, CategorySetting>;
		backupEnabled?: boolean;
		sheetsSyncEnabled?: boolean;
		lastBackupAt?: string;
		onEdit: (_provider: UserProviderInfo) => void;
		onDelete: (_provider: UserProviderInfo) => void;
		onBackupToggle?: (_providerId: string, _enabled: boolean) => void;
		onSheetsSyncToggle?: (_providerId: string, _enabled: boolean) => void;
		onUpdated?: (_provider: UserProviderInfo) => void;
		onReconnect?: (_provider: UserProviderInfo) => void;
	} = $props();

	let expanded = $state(false);
	let syncStatus = $state<Record<string, { total: number; synced: number; failed: number }> | null>(
		null
	);
	let isBackfilling = $state(false);
	let isLoadingSyncStatus = $state(false);

	function getProviderIcon(providerType: string) {
		return providerUi(providerType)?.icon ?? Cloud;
	}

	function formatLastSync(lastSyncAt?: string): string {
		if (!lastSyncAt) return 'Never';
		const date = new Date(lastSyncAt);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins} min ago`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
		const diffDays = Math.floor(diffHours / 24);
		return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
	}

	async function loadSyncStatus() {
		isLoadingSyncStatus = true;
		try {
			syncStatus = await providerApi.getSyncStatus(provider.id);
		} catch {
			// Sync status is informational; a failure keeps the previous value.
		} finally {
			isLoadingSyncStatus = false;
		}
	}

	async function handleBackfill() {
		isBackfilling = true;
		try {
			const result = await providerApi.backfillProvider(provider.id);
			if (result.created > 0) {
				appStore.showSuccess(`Queued ${result.created} photos for sync`);
			} else {
				appStore.showSuccess('All photos already synced');
			}
			await loadSyncStatus();
		} catch (e) {
			appStore.showError(`Couldn't start syncing photos. ${userFacingErrorMessage(e)}`);
		} finally {
			isBackfilling = false;
		}
	}

	onMount(() => {
		providerCatalog.load();
		loadSyncStatus();
	});

	let Icon = $derived(getProviderIcon(provider.providerType));

	let supportsZipBackup = $derived(providerSupportsZipBackup(provider.providerType));
	let supportsSheets = $derived(supportsSheetsBackup(provider.providerType));
	let sheetsPaused = $derived(
		!!settingsStore.settings?.backupConfig?.providers[provider.id]?.sheetsAutoPausedAt
	);
	let isResuming = $state(false);

	async function resumeSheetsBackups() {
		isResuming = true;
		try {
			await settingsApi.resumeSheetsBackups(provider.id);
			await settingsStore.load();
		} catch (e) {
			appStore.showError(`Couldn't resume automatic Sheets backups. ${userFacingErrorMessage(e)}`);
		} finally {
			isResuming = false;
		}
	}
	let details = $derived(providerDetails(provider.providerType, provider.config ?? {}));
	let zipBackupProviders = $derived(
		new Intl.ListFormat('en', { type: 'disjunction' }).format(
			providerCatalog.storage.filter(e => !e.features.photoOnly).map(e => e.label)
		)
	);
</script>

<div class="border-b py-3 last:border-b-0" data-slot="provider-tile">
	<div>
		<!-- min-w-0 is required: grid items default to min-width auto and overflow. -->
		<div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-3 min-w-0">
				<div
					class="flex size-11 shrink-0 items-center justify-center rounded-(--r-md) bg-sunk"
					aria-hidden="true"
				>
					<Icon class="size-5 text-foreground" />
				</div>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
						<p class="truncate min-w-0 font-medium">{provider.displayName}</p>
						<ProviderStatusBadge status={provider.status} />
						{#if lastBackupAt}
							<Badge variant="ok">Last backup {formatLastSync(lastBackupAt)}</Badge>
						{/if}
					</div>
					<p class="text-sm text-muted-foreground truncate">
						{#if provider.config?.['accountEmail']}
							{provider.config['accountEmail']} ·
						{/if}
						{providerLabel(provider.providerType)}
					</p>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2 self-end sm:gap-1 sm:self-auto">
				<Button
					variant="ghost"
					size="icon"
					class="size-10"
					aria-label="Edit {provider.displayName}"
					onclick={() => onEdit(provider)}
				>
					<Pencil class="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					class="size-10"
					aria-label="Delete {provider.displayName}"
					onclick={() => onDelete(provider)}
				>
					<Trash2 class="h-4 w-4 text-destructive" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					class="size-10"
					aria-label={expanded ? 'Collapse provider details' : 'Expand provider details'}
					aria-expanded={expanded}
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<ChevronUp class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</Button>
			</div>
		</div>
	</div>

	<div class="mt-3 sm:pl-14">
		<div class="space-y-3">
			<ProviderHealth
				{provider}
				onFix={(p, kind) => (kind === 'reconnect' && onReconnect ? onReconnect(p) : onEdit(p))}
				onUpdated={p => onUpdated?.(p)}
			/>
			{#if providerCatalog.error && !providerCatalog.loaded}
				<LoadErrorCard
					compact
					title="Couldn't load the backup options"
					message={providerCatalog.error}
					onRetry={() => providerCatalog.load()}
				/>
			{:else if !providerCatalog.loaded}
				<span class="sr-only">Loading backup options</span>
			{:else if supportsZipBackup}
				<div class="flex items-center justify-between">
					<div class="space-y-0.5">
						<Label for="backup-{provider.id}" class="text-sm">ZIP backup</Label>
						<p class="text-xs text-muted-foreground">Store ZIP backups on this provider</p>
					</div>
					<Switch
						id="backup-{provider.id}"
						checked={backupEnabled}
						onCheckedChange={checked => onBackupToggle?.(provider.id, checked === true)}
					/>
				</div>
				{#if backupEnabled}
					<p class="text-xs text-muted-foreground">
						Backups include your data only — images and photos are not included.
					</p>
				{/if}
			{:else}
				<p class="text-xs text-muted-foreground">
					{providerLabel(provider.providerType)} stores your photos only. Use a {zipBackupProviders}
					provider for ZIP data backups.
				</p>
			{/if}
			{#if supportsSheets}
				<div class="flex items-center justify-between">
					<div class="space-y-0.5">
						<Label for="sheets-{provider.id}" class="text-sm">Sheets sync</Label>
						<p class="text-xs text-muted-foreground">Sync data to a Google Spreadsheet</p>
					</div>
					<Switch
						id="sheets-{provider.id}"
						checked={sheetsSyncEnabled}
						onCheckedChange={checked => onSheetsSyncToggle?.(provider.id, checked === true)}
					/>
				</div>
				{#if sheetsPaused}
					<Alert variant="warning" role="status">
						<AlertDescription class="space-y-2">
							<p>
								Automatic backups to this spreadsheet are paused, because restoring from it was
								refused. If you want to keep it as it is, make a copy in Google Drive first. A
								backup you start, or the next automatic one after you resume, writes over it.
							</p>
							<Button
								variant="outline"
								size="sm"
								class="h-10"
								onclick={resumeSheetsBackups}
								disabled={isResuming}
							>
								{#if isResuming}
									<LoaderCircle class="h-3 w-3 animate-spin mr-1" />
								{/if}
								Resume Automatic Backups
							</Button>
						</AlertDescription>
					</Alert>
				{/if}
			{/if}
		</div>
	</div>

	{#if expanded}
		<div class="mt-4 sm:pl-14">
			<div class="mb-4 space-y-3 border-t pt-4">
				<p class="text-sm font-medium text-muted-foreground">Provider Settings</p>
				{#if details.length > 0}
					<div class="space-y-1 text-sm">
						{#each details as detail (detail.label)}
							<div>
								<span class="text-muted-foreground">{detail.label}:</span>
								<span>{detail.value}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="space-y-3 border-t pt-4">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-muted-foreground">
						Storage · <span class="font-mono text-xs">
							{(provider.config?.['photoRootPath'] as string) ?? 'Photos'}
						</span>
					</p>
					<Button
						variant="outline"
						size="sm"
						class="h-10"
						onclick={handleBackfill}
						disabled={isBackfilling}
					>
						{#if isBackfilling}
							<LoaderCircle class="h-3 w-3 animate-spin mr-1" />
							Syncing...
						{:else}
							<RefreshCw class="h-3 w-3 mr-1" />
							Sync All
						{/if}
					</Button>
				</div>
				{#if isLoadingSyncStatus}
					<div class="flex justify-center py-2">
						<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				{:else}
					{#each Object.entries(categorySettings) as [category, setting] (category)}
						{@const label = PHOTO_CATEGORY_LABELS[category as PhotoCategory] ?? category}
						{@const status = syncStatus?.[category]}
						{@const pct =
							status && status.total > 0 ? Math.round((status.synced / status.total) * 100) : 0}
						<div class="space-y-1 {setting.enabled ? '' : 'opacity-40'}">
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">
									{label}
									<span class="font-mono ml-1">{setting.folderPath}</span>
								</span>
								<span class="text-muted-foreground">
									{#if !setting.enabled}
										disabled
									{:else if status}
										{status.synced}/{status.total}
										{#if status.failed > 0}
											<span class="text-destructive">({status.failed} failed)</span>
										{/if}
									{:else}
										—
									{/if}
								</span>
							</div>
							<Progress value={setting.enabled ? pct : 0} class="h-1.5" />
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
