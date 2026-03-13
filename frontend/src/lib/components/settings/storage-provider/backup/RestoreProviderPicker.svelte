<script lang="ts">
	import { Cloud, Database, FileArchive, FileSpreadsheet } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import type { RestoreProviderInfo } from '$lib/types';

	let {
		providers,
		onSelect
	}: {
		providers: RestoreProviderInfo[];
		onSelect: (_providerId: string, _sourceType: 'zip' | 'sheets') => void;
	} = $props();

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
</script>

{#if providers.length === 0}
	<div class="text-center py-6">
		<Database class="h-10 w-10 text-muted-foreground mx-auto mb-2" />
		<p class="text-sm font-medium text-foreground">No backups available</p>
		<p class="text-xs text-muted-foreground mt-1">
			Create a backup first to enable provider-based restore
		</p>
	</div>
{:else}
	<div class="grid gap-3">
		{#each providers as provider (provider.providerId)}
			{@const Icon = getProviderIcon(provider.providerType)}
			{#if provider.sourceTypes.length === 1 && provider.sourceTypes[0]}
				{@const singleSource = provider.sourceTypes[0]}
				<button
					type="button"
					class="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted"
					onclick={() => onSelect(provider.providerId, singleSource)}
				>
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
						<Icon class="h-5 w-5 text-muted-foreground" />
					</div>
					<div class="flex-1 min-w-0">
						<div class="font-medium text-foreground">{provider.displayName}</div>
						<div class="text-sm text-muted-foreground truncate">
							{provider.accountEmail} · {getProviderTypeLabel(provider.providerType)}
						</div>
					</div>
					<Badge variant="secondary" class="text-xs">
						{singleSource === 'zip' ? 'ZIP' : 'Sheets'}
					</Badge>
				</button>
			{:else}
				{#each provider.sourceTypes as sourceType (sourceType)}
					<button
						type="button"
						class="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted"
						onclick={() => onSelect(provider.providerId, sourceType)}
					>
						<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
							{#if sourceType === 'zip'}
								<FileArchive class="h-5 w-5 text-muted-foreground" />
							{:else}
								<FileSpreadsheet class="h-5 w-5 text-muted-foreground" />
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="font-medium text-foreground">
								{provider.displayName} — {sourceType === 'zip' ? 'ZIP Backup' : 'Google Sheets'}
							</div>
							<div class="text-sm text-muted-foreground truncate">
								{provider.accountEmail} · {getProviderTypeLabel(provider.providerType)}
							</div>
						</div>
					</button>
				{/each}
			{/if}
		{/each}
	</div>
{/if}
