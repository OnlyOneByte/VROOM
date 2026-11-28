<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { ArrowLeft, LoaderCircle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import StorageProvidersCard from '#lib/components/settings/cards/StorageProvidersCard.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { fetchLastSyncTime } from '#lib/utils/sync/sync-manager.ts';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { routes } from '#lib/routes.ts';
	import { supportsZipBackup } from '#lib/constants/providers.ts';
	import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';
	import type {
		BackupConfig,
		BackupOrchestratorResult,
		RestoreResult,
		UserProviderInfo
	} from '#lib/types/index.ts';

	let settings = $derived(settingsStore.settings);
	let loadError = $derived(settingsStore.error && !settings ? settingsStore.error : null);

	let syncInactivityMinutes = $state(5);
	let isInitialized = $state(false);
	let storageProviders = $state<UserProviderInfo[]>([]);

	let backupConfig = $derived<BackupConfig>(settings?.backupConfig ?? { providers: {} });
	let backupProvidersEnabled = $derived(Object.values(backupConfig.providers).some(p => p.enabled));
	let sheetsSyncEnabled = $derived(
		Object.values(backupConfig.providers).some(p => p.sheetsSyncEnabled)
	);
	let backupProviders = $derived.by(() => {
		const enabledIds = Object.entries(backupConfig.providers)
			.filter(([, s]) => s.enabled)
			.map(([id]) => id);
		return storageProviders
			.filter(p => enabledIds.includes(p.id))
			.map(p => ({ id: p.id, displayName: p.displayName, providerType: p.providerType }));
	});
	let backupChoices = $derived(
		storageProviders
			.filter(p => supportsZipBackup(p.providerType))
			.map(p => {
				const saved = backupConfig.providers[p.id];
				const zip = saved?.enabled === true;
				const sheets = saved?.sheetsSyncEnabled === true;
				return {
					id: p.id,
					displayName: p.displayName,
					savedOn: zip || sheets,
					status: zip ? 'Backups on' : sheets ? 'Sheets backups on' : 'Backups off'
				};
			})
	);

	let showBackupDialog = $state(false);
	let showRestoreDialog = $state(false);

	type BackupDialogModule =
		typeof import('#lib/components/settings/storage-provider/backup/BackupDialog.svelte');
	type RestoreDialogModule =
		typeof import('#lib/components/settings/storage-provider/backup/RestoreDialog.svelte');
	let backupDialog = $state<Promise<BackupDialogModule | null> | null>(null);
	let restoreDialog = $state<Promise<RestoreDialogModule | null> | null>(null);

	onMount(() => {
		settingsStore.load();
		loadProviders();
		void providerCatalog.load();
	});

	function retryLoad() {
		settingsStore.load();
		loadProviders();
	}

	async function loadProviders() {
		storageProviders = await providerApi
			.getProviders('storage')
			.catch((): UserProviderInfo[] => []);
	}

	$effect(() => {
		if (settings && !isInitialized) {
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
			isInitialized = true;
		}
	});

	async function saveSyncInterval() {
		try {
			await settingsStore.update({ syncInactivityMinutes });
			await fetchLastSyncTime();
			appStore.showSuccess('Backup timing saved');
		} catch (error) {
			appStore.showError(`Couldn't save settings. ${userFacingErrorMessage(error)}`);
			isInitialized = false;
		}
	}

	let syncOnInactivityRequested = false;

	$effect(() => {
		if (!settings || syncOnInactivityRequested || settings.syncOnInactivity !== false) return;
		if (!backupProvidersEnabled && !sheetsSyncEnabled) return;
		syncOnInactivityRequested = true;
		settingsStore.update({ syncOnInactivity: true }).catch(() => {
			syncOnInactivityRequested = false;
		});
	});

	function dialogLoadFailed(error: unknown) {
		appStore.showError(`Couldn't open this dialog. ${userFacingErrorMessage(error)}`);
	}

	function handleBackupNowClick() {
		backupDialog ??=
			import('#lib/components/settings/storage-provider/backup/BackupDialog.svelte').catch(
				error => {
					backupDialog = null;
					showBackupDialog = false;
					dialogLoadFailed(error);
					return null;
				}
			);
		showBackupDialog = true;
	}

	const names = (ids: string[]) =>
		new Intl.ListFormat('en', { type: 'conjunction' }).format(
			ids.map(id => storageProviders.find(provider => provider.id === id)?.displayName ?? id)
		);

	function cleanupProblem(results: BackupOrchestratorResult['results']): string | null {
		const warnings = Object.entries(results).flatMap(([id, result]) => {
			const warning = Object.values(result.capabilities).find(c => c.warning)?.warning;
			return warning ? [{ id, warning }] : [];
		});
		if (warnings.length === 0) return null;
		return `${names(warnings.map(w => w.id))}: ${warnings[0]?.warning}`;
	}

	function backupProblem(
		failedProviders: string[],
		results: BackupOrchestratorResult['results']
	): string {
		const unusable = failedProviders.filter(id => results[id]?.unusable);
		const failed = failedProviders.filter(id => !results[id]?.unusable);
		const problems = [
			...(failed.length > 0 ? [`${names(failed)} failed`] : []),
			...(unusable.length > 0 ? [`${names(unusable)} can't be used`] : [])
		];
		const them = failedProviders.length === 1 ? 'it' : 'them';
		const fix = failed.length > 0 ? 'Check' : 'Reconnect';
		return `${problems.join(' and ')}. ${fix} ${them} under Connected, then try again.`;
	}

	function failedBackupProblem(error: unknown): string | null {
		if (!(error instanceof ApiError) || error.code !== 'BACKUP_FAILED') return null;
		const { failedProviders, results } = error.details ?? {};
		if (!Array.isArray(failedProviders) || failedProviders.length === 0) return null;
		if (typeof results !== 'object' || results === null) return null;
		return backupProblem(
			failedProviders.map(String),
			results as BackupOrchestratorResult['results']
		);
	}

	async function handleBackupExecute(providerIds?: string[]) {
		showBackupDialog = false;
		const toastId = toast.loading('Backup in progress...');

		try {
			const data = await settingsStore.executeSync(['backup'], true, providerIds);
			const providers = (count: number) => `${count} place${count === 1 ? '' : 's'}`;

			const cleanup = cleanupProblem(data.results);
			if (data.outcome === 'success') {
				const done = `Backed up to ${providers(Object.keys(data.results).length)}`;
				if (cleanup) toast.warning(`${done}. ${cleanup}`, { id: toastId });
				else toast.success(done, { id: toastId });
			} else if (data.outcome === 'partial') {
				const succeeded = Object.values(data.results).filter(r => r.success).length;
				const problems = [backupProblem(data.failedProviders, data.results), cleanup];
				toast.warning(
					`Backed up to ${providers(succeeded)}. ${problems.filter(Boolean).join(' ')}`,
					{ id: toastId }
				);
			} else if (data.outcome === 'noop') {
				toast.info(
					providerIds
						? 'Nothing was backed up. Reload the page to see your storage, then try again.'
						: 'Nothing to back up: backups are off for all storage',
					{ id: toastId }
				);
			} else {
				toast.error(`Couldn't back up. ${backupProblem(data.failedProviders, data.results)}`, {
					id: toastId
				});
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			toast.dismiss(toastId);
			appStore.showError(
				`Couldn't back up. ${failedBackupProblem(error) ?? userFacingErrorMessage(error)}`
			);
		}
	}

	function handleRestoreClick() {
		restoreDialog ??=
			import('#lib/components/settings/storage-provider/backup/RestoreDialog.svelte').catch(
				error => {
					restoreDialog = null;
					showRestoreDialog = false;
					dialogLoadFailed(error);
					return null;
				}
			);
		showRestoreDialog = true;
	}

	function handleRestoreComplete(result: RestoreResult) {
		const sum = (counts: Record<string, number>) =>
			Object.values(counts).reduce((total, count) => total + count, 0);
		if (result.imported && result.kept) {
			const added = sum(result.imported);
			appStore.showSuccess(
				`Added ${added === 1 ? '1 record' : `${added} records`} from the backup. ${sum(result.kept)} already here or skipped.`
			);
		} else if (result.imported) {
			appStore.showSuccess(`Successfully restored ${sum(result.imported)} records`);
		}
		settingsStore.load();
		isInitialized = false;
	}
</script>

<svelte:head>
	<title>Backups and storage - VROOM Car Tracker</title>
	<meta name="description" content="Connect your own storage for photos and backups" />
</svelte:head>

<div class="mx-auto w-full max-w-2xl lg:max-w-5xl">
	<div class="mb-6">
		<PageHeader
			title="Backups and storage"
			description="Your data lives in VROOM's database. Backups go to storage you own."
		>
			{#snippet back()}
				<Button
					variant="ghost"
					size="icon-lg"
					class="shrink-0"
					aria-label="Back to Settings"
					href={resolve(routes.settings)}
				>
					<ArrowLeft class="size-5" aria-hidden="true" />
				</Button>
			{/snippet}
		</PageHeader>
	</div>

	{#if loadError}
		<LoadErrorCard
			title="Couldn't load your storage settings"
			message={loadError}
			onRetry={retryLoad}
		/>
	{:else if !settings}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
		</div>
	{:else}
		<StorageProvidersCard
			bind:syncInactivityMinutes
			onSyncInactivityChange={() => void saveSyncInterval()}
			onBackupNow={handleBackupNowClick}
			onRestore={handleRestoreClick}
		/>
		<p class="mt-6 text-sm text-muted-foreground">
			Want a copy on your own computer?
			<a
				href="{resolve(routes.settings)}#settings-data"
				class="font-semibold text-accent-ink underline-offset-4 hover:underline"
			>
				Export all your data from Settings
			</a>
		</p>
	{/if}

	{#if backupDialog}
		{#await backupDialog then module}
			{#if module}
				<module.default
					bind:open={showBackupDialog}
					providers={backupChoices}
					onSync={handleBackupExecute}
				/>
			{/if}
		{/await}
	{/if}

	{#if restoreDialog}
		{#await restoreDialog then module}
			{#if module}
				<module.default
					bind:open={showRestoreDialog}
					{backupProviders}
					{sheetsSyncEnabled}
					onRestore={handleRestoreComplete}
					onClose={() => {}}
				/>
			{/if}
		{/await}
	{/if}
</div>
