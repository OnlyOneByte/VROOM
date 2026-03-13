<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import { LoaderCircle, RefreshCw } from '@lucide/svelte';
	import type { BackupOrchestratorResult } from '$lib/types';

	interface Props {
		open: boolean;
		isSyncing: boolean;
		backupProvidersEnabled: boolean;
		syncResults: BackupOrchestratorResult | null;
		onSync: () => void;
	}

	let {
		open = $bindable(),
		isSyncing,
		backupProvidersEnabled,
		syncResults,
		onSync
	}: Props = $props();

	let hasResults = $derived(syncResults && Object.keys(syncResults.results).length > 0);

	interface ProviderResultDisplay {
		id: string;
		success: boolean;
		message?: string;
		capabilities: Record<
			string,
			{ success: boolean; message?: string; metadata?: Record<string, unknown> }
		>;
	}

	let providerResults = $derived.by((): ProviderResultDisplay[] => {
		if (!syncResults?.results) return [];
		return Object.entries(syncResults.results).map(([id, result]) => ({
			id,
			success: result.success,
			message: result.message,
			capabilities: result.capabilities
		}));
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Backup Now</Dialog.Title>
			<Dialog.Description>Run a backup to all enabled providers</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			{#if !backupProvidersEnabled}
				<p class="text-sm text-muted-foreground">
					Enable backup on a storage provider first to use cloud backup.
				</p>
			{/if}

			<!-- Per-Provider Backup Results -->
			{#if hasResults}
				<div class="border rounded-lg p-4 bg-muted">
					<h4 class="font-medium mb-3">Backup Results</h4>
					<div class="space-y-3 text-sm">
						{#each providerResults as result (result.id)}
							<div class="space-y-1">
								<div class="flex items-center gap-2">
									<span class="font-medium {result.success ? 'text-chart-2' : 'text-destructive'}">
										{result.success ? '✓' : '✗'}
									</span>
									<span class="text-foreground">{result.id}</span>
									<Badge variant={result.success ? 'default' : 'destructive'} class="text-xs">
										{result.success ? 'Success' : 'Failed'}
									</Badge>
								</div>
								{#if !result.success && result.message}
									<div class="text-xs text-muted-foreground pl-5">
										{result.message}
									</div>
								{/if}
								{#each Object.entries(result.capabilities) as [capName, cap] (capName)}
									{#if cap.success && cap.metadata}
										{#if cap.metadata['fileName']}
											<div class="text-xs text-muted-foreground pl-5">
												{capName}: {cap.metadata['fileName']}
											</div>
										{/if}
										{#if (cap.metadata['deletedOldBackups'] as number) > 0}
											<div class="text-xs text-muted-foreground pl-5">
												Cleaned up {cap.metadata['deletedOldBackups']} old backup{(cap.metadata[
													'deletedOldBackups'
												] as number) > 1
													? 's'
													: ''}
											</div>
										{/if}
										{#if cap.metadata['spreadsheetId']}
											<div class="text-xs text-muted-foreground pl-5">Sheets synced</div>
										{/if}
									{:else if !cap.success && cap.message}
										<div class="text-xs text-destructive pl-5">
											{capName}: {cap.message}
										</div>
									{/if}
								{/each}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Skipped result -->
			{#if syncResults?.skipped}
				<div class="border rounded-lg p-4 bg-muted">
					<p class="text-sm text-muted-foreground">No changes since last backup — skipped.</p>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>
				{hasResults || syncResults?.skipped ? 'Close' : 'Cancel'}
			</Button>
			{#if !hasResults && !syncResults?.skipped}
				<Button onclick={onSync} disabled={isSyncing || !backupProvidersEnabled}>
					{#if isSyncing}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Backing up...
					{:else}
						<RefreshCw class="mr-2 h-4 w-4" />
						Backup Now
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
