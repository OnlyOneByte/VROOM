<script lang="ts">
	import { onMount } from 'svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		Settings as SettingsIcon,
		Save,
		LoaderCircle,
		ChevronRight,
		ArrowLeft,
		CircleUser,
		Link2,
		Monitor,
		Shield,
		Users,
		Bell,
		Mail,
		Calendar,
		LogOut,
		Download,
		Trash2,
		UserPlus,
		Clock
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import UnitPreferencesCard from '$lib/components/settings/cards/UnitPreferencesCard.svelte';
	import ThemeCard from '$lib/components/settings/cards/ThemeCard.svelte';
	import PWAInstallCard from '$lib/components/settings/cards/PwaInstallCard.svelte';
	import BackupNowDialog from '$lib/components/settings/storage-provider/backup/BackupDialog.svelte';
	import UnifiedRestoreDialog from '$lib/components/settings/storage-provider/backup/RestoreDialog.svelte';
	import PhotoStorageSettings from '$lib/components/settings/cards/StorageProvidersCard.svelte';
	import { fetchLastSyncTime } from '$lib/utils/sync-manager';
	import { providerApi } from '$lib/services/provider-api';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import type {
		BackupConfig,
		BackupOrchestratorResult,
		RestoreResult,
		UserProviderInfo
	} from '$lib/types';

	let activeView = $state<'settings' | 'profile'>('settings');
	let user = $derived(authStore.user);

	let initials = $derived.by(() => {
		if (!user?.displayName) return '?';
		return user.displayName
			.split(' ')
			.map((n: string) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	});

	let memberSince = $derived.by(() => {
		if (!user?.createdAt) return '';
		return new Date(user.createdAt).toLocaleDateString('en-US', {
			month: 'long',
			year: 'numeric'
		});
	});

	// Derive state from store
	let settings = $derived(settingsStore.settings);
	let isLoading = $derived(settingsStore.isLoading);

	let isSaving = $state(false);
	let isBackingUp = $state(false);
	let isSyncing = $state(false);

	// Unit preferences
	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');

	// Backup settings — derived from backupConfig
	let autoBackupEnabled = $state(false);
	let backupFrequency = $state<'daily' | 'weekly' | 'monthly'>('weekly');
	let syncInactivityMinutes = $state(5);

	// Provider state for backup card and restore dialog
	let storageProviders = $state<UserProviderInfo[]>([]);

	// Derived backup state from backupConfig
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

	// Dialog state
	let showBackupDialog = $state(false);
	let showRestoreDialog = $state(false);
	let syncResults = $state<BackupOrchestratorResult | null>(null);

	let isInitialized = $state(false);

	onMount(() => {
		settingsStore.load();
		loadProviders();
	});

	async function loadProviders() {
		try {
			storageProviders = await providerApi.getProviders('storage');
		} catch {
			// Non-critical
		}
	}

	$effect(() => {
		if (settings && !isInitialized) {
			distanceUnit = settings.unitPreferences.distanceUnit;
			volumeUnit = settings.unitPreferences.volumeUnit;
			chargeUnit = settings.unitPreferences.chargeUnit;
			currencyUnit = settings.currencyUnit;
			autoBackupEnabled = settings.autoBackupEnabled;
			backupFrequency = settings.backupFrequency;
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
			isInitialized = true;
		}
	});

	async function handleSave() {
		isSaving = true;
		try {
			await settingsStore.update({
				unitPreferences: { distanceUnit, volumeUnit, chargeUnit },
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				syncOnInactivity: backupProvidersEnabled || sheetsSyncEnabled,
				syncInactivityMinutes
			});
			await fetchLastSyncTime();
			isInitialized = false;
			appStore.showSuccess('Settings saved successfully');
		} catch {
			appStore.showError('Failed to save settings');
		} finally {
			isSaving = false;
		}
	}

	async function handleBackup() {
		isBackingUp = true;
		try {
			await settingsStore.downloadBackup();
			appStore.showSuccess('Backup downloaded successfully');
		} catch {
			appStore.showError('Failed to create backup');
		} finally {
			isBackingUp = false;
		}
	}

	function handleBackupNowClick() {
		syncResults = null;
		showBackupDialog = true;
	}

	async function handleBackupExecute() {
		isSyncing = true;
		syncResults = null;
		try {
			const result = await settingsStore.executeSync(['backup'], true);
			const data = result?.data;
			if (data) {
				syncResults = data;

				// Handle 409 backup-in-progress
				if (data.status === 'in_progress') {
					appStore.showError('A backup is already in progress');
					return;
				}

				if (data.skipped) {
					return;
				}

				const successCount = Object.values(data.results).filter(r => r.success).length;
				const failCount = Object.values(data.results).filter(r => !r.success).length;

				if (successCount > 0) {
					appStore.showSuccess(
						`Backed up to ${successCount} provider${successCount > 1 ? 's' : ''}`
					);
				}
				if (failCount > 0) {
					appStore.showError(`${failCount} provider${failCount > 1 ? 's' : ''} failed`);
				}
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Failed to execute backup';
			if (msg.includes('BACKUP_IN_PROGRESS') || msg.includes('backup is already in progress')) {
				appStore.showError('A backup is already in progress. Please try again later.');
			} else {
				appStore.showError(msg);
			}
		} finally {
			isSyncing = false;
		}
	}

	function handleRestoreClick() {
		showRestoreDialog = true;
	}

	function handleRestoreComplete(result: RestoreResult) {
		if (result.imported) {
			const total = Object.values(result.imported).reduce((sum, count) => sum + count, 0);
			appStore.showSuccess(`Successfully restored ${total} records`);
		}
		settingsStore.load();
		isInitialized = false;
	}
</script>

{#snippet profileContent()}
	<div class="space-y-6">
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<CircleUser class="h-5 w-5 text-muted-foreground" /><CardTitle>Identity</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Your account details and personal information</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex items-center gap-4 mb-6">
					<Avatar class="h-16 w-16"
						><AvatarFallback class="text-lg">{initials}</AvatarFallback></Avatar
					>
					<div>
						<p class="text-lg font-semibold">{user?.displayName ?? 'Unknown'}</p>
						<p class="text-sm text-muted-foreground">{user?.email ?? ''}</p>
					</div>
				</div>
				<Separator class="mb-4" />
				<div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<CircleUser class="h-4 w-4" /><span>Display Name</span>
						</div>
						<span class="text-sm text-muted-foreground">Edit coming soon</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Mail class="h-4 w-4" /><span>Email</span>
						</div>
						<span class="text-sm text-muted-foreground">Linked to OAuth</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Calendar class="h-4 w-4" /><span>Member Since</span>
						</div>
						<span class="text-sm">{memberSince || '—'}</span>
					</div>
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader
				><div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Link2 class="h-5 w-5 text-muted-foreground" /><CardTitle>Connected Accounts</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Manage linked services and OAuth providers</CardDescription></CardHeader
			>
			<CardContent
				><div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
								<svg class="h-5 w-5" viewBox="0 0 24 24"
									><path
										d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
										fill="#4285F4"
									/><path
										d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
										fill="#34A853"
									/><path
										d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
										fill="#FBBC05"
									/><path
										d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
										fill="#EA4335"
									/></svg
								>
							</div>
							<div>
								<p class="text-sm font-medium">Google</p>
								<p class="text-xs text-muted-foreground">Sign-in & Drive access</p>
							</div>
						</div>
						<Badge variant="outline">Connected</Badge>
					</div>
					<Separator />
					<p class="text-sm text-muted-foreground">
						Manage OAuth scopes, re-authenticate, and link additional providers.
					</p>
				</div></CardContent
			>
		</Card>

		<Card
			><CardHeader
				><div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Monitor class="h-5 w-5 text-muted-foreground" /><CardTitle>Sessions</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>View and manage your active sessions</CardDescription></CardHeader
			><CardContent
				><div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Monitor class="h-4 w-4" /><span>Active sessions</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Clock class="h-4 w-4" /><span>Last login</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<LogOut class="h-4 w-4" /><span>Sign out other devices</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div></CardContent
			></Card
		>

		<Card
			><CardHeader
				><div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Shield class="h-5 w-5 text-muted-foreground" /><CardTitle>Data & Privacy</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Control your data and privacy preferences</CardDescription></CardHeader
			><CardContent
				><div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Download class="h-4 w-4" /><span>Export all data</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Trash2 class="h-4 w-4" /><span>Delete account</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Shield class="h-4 w-4" /><span>Data retention preferences</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div></CardContent
			></Card
		>

		<Card
			><CardHeader
				><div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Users class="h-5 w-5 text-muted-foreground" /><CardTitle>Sharing</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Household access and shared vehicles</CardDescription></CardHeader
			><CardContent
				><div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<UserPlus class="h-4 w-4" /><span>Invite household member</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Users class="h-4 w-4" /><span>Manage shared access</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div></CardContent
			></Card
		>

		<Card
			><CardHeader
				><div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Bell class="h-5 w-5 text-muted-foreground" /><CardTitle>Notifications</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Reminders and alert preferences</CardDescription></CardHeader
			><CardContent
				><div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Bell class="h-4 w-4" /><span>Payment reminders</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Bell class="h-4 w-4" /><span>Maintenance reminders</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Bell class="h-4 w-4" /><span>Backup failure alerts</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div></CardContent
			></Card
		>
	</div>
{/snippet}

<FormLayout>
	{#if activeView === 'profile'}
		<div class="mb-6">
			<button
				type="button"
				class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
				onclick={() => (activeView = 'settings')}
			>
				<ArrowLeft class="h-4 w-4" />Back to Settings
			</button>
			<h1 class="text-2xl font-bold tracking-tight">Profile</h1>
			<p class="text-muted-foreground">Manage your account and personal preferences</p>
		</div>
		{@render profileContent()}
	{:else}
		<div class="mb-6">
			<h1 class="text-3xl font-bold text-foreground flex items-center gap-3">
				<SettingsIcon class="h-8 w-8 text-primary" />Settings
			</h1>
			<p class="text-muted-foreground mt-2">Manage your preferences and data</p>
		</div>

		{#if isLoading}
			<div class="flex items-center justify-center py-12">
				<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
			</div>
		{:else}
			<div class="space-y-6 pb-32 sm:pb-24">
				<button type="button" class="w-full text-left" onclick={() => (activeView = 'profile')}>
					<Card class="hover:bg-accent/50 transition-colors cursor-pointer">
						<CardContent class="flex items-center gap-4 py-5">
							<Avatar class="h-12 w-12"
								><AvatarFallback class="bg-primary/10 text-primary text-sm font-medium"
									>{initials}</AvatarFallback
								></Avatar
							>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-semibold text-foreground truncate">
									{user?.displayName ?? 'User'}
								</p>
								<p class="text-xs text-muted-foreground truncate">
									{user?.email ?? 'Account & profile settings'}
								</p>
							</div>
							<ChevronRight class="h-5 w-5 text-muted-foreground flex-shrink-0" />
						</CardContent>
					</Card>
				</button>

				<ThemeCard />
				<UnitPreferencesCard bind:distanceUnit bind:volumeUnit bind:chargeUnit bind:currencyUnit />
				<PWAInstallCard />
				<PhotoStorageSettings
					{isBackingUp}
					bind:syncInactivityMinutes
					onBackupNow={handleBackupNowClick}
					onRestore={handleRestoreClick}
					onDownloadBackup={handleBackup}
				/>
			</div>
		{/if}

		<Button
			onclick={handleSave}
			disabled={isSaving}
			class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto sm:rounded-full rounded-full group bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 z-50 h-16 sm:h-16 pl-6 pr-10 border-0 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if isSaving}
				<LoaderCircle class="h-6 w-6 animate-spin transition-transform duration-300" />
				<span class="font-bold text-lg">Saving...</span>
			{:else}
				<Save class="h-6 w-6 transition-transform duration-300 group-hover:scale-110" />
				<span class="font-bold text-lg">Save Settings</span>
			{/if}
		</Button>
	{/if}

	<BackupNowDialog
		bind:open={showBackupDialog}
		{isSyncing}
		{backupProvidersEnabled}
		{syncResults}
		onSync={handleBackupExecute}
	/>

	<UnifiedRestoreDialog
		bind:open={showRestoreDialog}
		{backupProviders}
		{sheetsSyncEnabled}
		onRestore={handleRestoreComplete}
		onClose={() => {}}
	/>
</FormLayout>
