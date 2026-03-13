<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronDown,
		ChevronUp,
		Pencil,
		Trash2,
		Cloud,
		Database,
		RefreshCw,
		LoaderCircle
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Progress } from '$lib/components/ui/progress';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { providerApi } from '$lib/services/provider-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { PHOTO_CATEGORY_LABELS } from '$lib/constants/ui';
	import type { PhotoCategory, CategorySetting, UserProviderInfo } from '$lib/types';

	let {
		provider,
		categorySettings,
		backupEnabled = false,
		sheetsSyncEnabled = false,
		lastBackupAt,
		onEdit,
		onDelete,
		onBackupToggle,
		onSheetsSyncToggle
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
	} = $props();

	let expanded = $state(false);
	let syncStatus = $state<Record<string, { total: number; synced: number; failed: number }> | null>(
		null
	);
	let isBackfilling = $state(false);
	let isLoadingSyncStatus = $state(false);

	function getProviderIcon(providerType: string) {
		switch (providerType) {
			case 'google-drive':
				return Cloud;
			case 's3':
				return Database;
			default:
				return Cloud;
		}
	}

	function getProviderTypeLabel(providerType: string): string {
		switch (providerType) {
			case 'google-drive':
				return 'Google Drive';
			case 's3':
				return 'S3 Compatible';
			default:
				return providerType;
		}
	}

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (status) {
			case 'active':
				return 'default';
			case 'error':
				return 'destructive';
			case 'disconnected':
				return 'secondary';
			default:
				return 'outline';
		}
	}

	function getStatusLabel(status: string): string {
		switch (status) {
			case 'active':
				return 'Connected';
			case 'error':
				return 'Error';
			case 'disconnected':
				return 'Disconnected';
			default:
				return status;
		}
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
			// Silently fail — sync status is informational
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
		} catch {
			appStore.showError('Failed to start backfill');
		} finally {
			isBackfilling = false;
		}
	}

	onMount(() => {
		loadSyncStatus();
	});

	let Icon = $derived(getProviderIcon(provider.providerType));
</script>

<Card>
	<CardHeader class="pb-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3 min-w-0">
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
					<Icon class="h-5 w-5 text-muted-foreground" />
				</div>
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<p class="text-sm font-semibold truncate">{provider.displayName}</p>
						<Badge variant={getStatusVariant(provider.status)} class="text-xs">
							{getStatusLabel(provider.status)}
						</Badge>
					</div>
					<p class="text-xs text-muted-foreground truncate">
						{#if provider.config?.['accountEmail']}
							{provider.config['accountEmail']} ·
						{/if}
						{getProviderTypeLabel(provider.providerType)}
					</p>
				</div>
			</div>
			<div class="flex items-center gap-1">
				<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => onEdit(provider)}>
					<Pencil class="h-4 w-4" />
				</Button>
				<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => onDelete(provider)}>
					<Trash2 class="h-4 w-4 text-destructive" />
				</Button>
				<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => (expanded = !expanded)}>
					{#if expanded}
						<ChevronUp class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</Button>
			</div>
		</div>
	</CardHeader>

	<CardContent class="pt-0">
		<div class="space-y-3">
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
			{#if provider.providerType === 'google-drive'}
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
			{/if}
			{#if lastBackupAt}
				<p class="text-xs text-muted-foreground">Last backup: {formatLastSync(lastBackupAt)}</p>
			{/if}
		</div>
	</CardContent>

	{#if expanded}
		<CardContent class="pt-0">
			<Separator class="mb-4" />

			<!-- Provider-specific info -->
			<div class="space-y-3 mb-4">
				<p class="text-sm font-medium text-muted-foreground">Provider Settings</p>
				{#if provider.providerType === 's3'}
					<div class="space-y-1 text-sm">
						<div>
							<span class="text-muted-foreground">Endpoint:</span>
							<span>{(provider.config?.['endpoint'] as string) ?? '—'}</span>
						</div>
						<div>
							<span class="text-muted-foreground">Bucket:</span>
							<span>{(provider.config?.['bucket'] as string) ?? '—'}</span>
						</div>
						<div>
							<span class="text-muted-foreground">Region:</span>
							<span>{(provider.config?.['region'] as string) ?? '—'}</span>
						</div>
					</div>
				{/if}
			</div>

			<Separator class="mb-4" />

			<!-- Sync & Storage -->
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-muted-foreground">
						Storage · <span class="font-mono text-xs"
							>{(provider.config?.['photoRootPath'] as string) ?? 'Photos'}</span
						>
					</p>
					<Button variant="outline" size="sm" onclick={handleBackfill} disabled={isBackfilling}>
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
		</CardContent>
	{/if}
</Card>
