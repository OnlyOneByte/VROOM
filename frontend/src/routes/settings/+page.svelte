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
	} from 'lucide-svelte';
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
	import UnitPreferencesCard from '$lib/components/settings/UnitPreferencesCard.svelte';
	import ThemeCard from '$lib/components/settings/ThemeCard.svelte';
	import PWAInstallCard from '$lib/components/settings/PWAInstallCard.svelte';
	import BackupSyncCard from '$lib/components/settings/BackupSyncCard.svelte';
	import BackupNowDialog from '$lib/components/settings/BackupNowDialog.svelte';
	import RestoreDialog from '$lib/components/settings/RestoreDialog.svelte';
	import { fetchLastSyncTime } from '$lib/utils/sync-manager';
	import { settingsApi } from '$lib/services/settings-api';
	import { isVroomError } from '$lib/utils/error-handling';

	// Sub-view state
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

	function extractValidationErrors(error: unknown): string | null {
		if (isVroomError(error) && error.details) {
			const errors = error.details['validationErrors'];
			if (Array.isArray(errors) && errors.length > 0) {
				return (
					errors.slice(0, 5).join(', ') + (errors.length > 5 ? ` (+${errors.length - 5} more)` : '')
				);
			}
		}
		return null;
	}

	// Derive state directly from store
	let settings = $derived(settingsStore.settings);
	let isLoading = $derived(settingsStore.isLoading);

	let isSaving = $state(false);
	let isBackingUp = $state(false);
	let isRestoring = $state(false);
	let isSyncing = $state(false);

	// Unit preferences
	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');

	// Backup/sync settings
	let autoBackupEnabled = $state(false);
	let backupFrequency = $state<'daily' | 'weekly' | 'monthly'>('weekly');
	let googleDriveBackupEnabled = $state(false);
	let googleDriveBackupRetentionCount = $state(10);
	let googleDriveCustomFolderName = $state('');
	let googleSheetsSyncEnabled = $state(false);
	let syncInactivityMinutes = $state(5);

	// Dialog state
	let showRestoreDialog = $state(false);
	let showDriveRestoreDialog = $state(false);
	let showSheetsRestoreDialog = $state(false);
	let showBackupDialog = $state(false);
	let selectedFile = $state<File | null>(null);
	let restoreMode = $state<'preview' | 'replace' | 'merge'>('replace');
	let restorePreview = $state<Record<string, number | undefined> | null>(null);
	let restoreConflicts = $state<Array<{ table?: string; id?: string; field?: string }>>([]);
	let syncSheets = $state(true);
	let syncBackup = $state(true);
	let sheetsRestorePreview = $state<Record<string, number | undefined> | null>(null);
	let sheetsRestoreConflicts = $state<Array<{ table?: string; id?: string; field?: string }>>([]);
	let sheetsRestoreMode = $state<'preview' | 'replace' | 'merge'>('replace');
	let syncResults = $state<{
		success: boolean;
		data?: {
			results: Record<string, { success: boolean; message?: string; skipped?: boolean }>;
		};
	} | null>(null);
	let driveBackups = $state<
		Array<{
			fileId: string;
			fileName: string;
			size: string;
			createdTime: string;
			modifiedTime: string;
		}>
	>([]);
	let isLoadingBackups = $state(false);
	let selectedDriveBackup = $state<string | null>(null);

	let isInitialized = $state(false);

	onMount(() => {
		settingsStore.load();
	});

	$effect(() => {
		if (settings && !isInitialized) {
			distanceUnit = settings.unitPreferences.distanceUnit;
			volumeUnit = settings.unitPreferences.volumeUnit;
			chargeUnit = settings.unitPreferences.chargeUnit;
			currencyUnit = settings.currencyUnit;
			autoBackupEnabled = settings.autoBackupEnabled;
			backupFrequency = settings.backupFrequency;
			googleDriveBackupEnabled = settings.googleDriveBackupEnabled;
			googleDriveBackupRetentionCount = settings.googleDriveBackupRetentionCount || 10;
			googleDriveCustomFolderName = settings.googleDriveCustomFolderName || '';
			googleSheetsSyncEnabled = settings.googleSheetsSyncEnabled || false;
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
			isInitialized = true;

			if (settings.googleDriveBackupEnabled && !settings.googleDriveBackupFolderId) {
				settingsStore.initializeDrive().catch(() => {});
			}
		}
	});

	// --- Save ---
	async function handleSave() {
		isSaving = true;
		try {
			await settingsStore.configureSyncSettings({
				googleSheetsSyncEnabled,
				googleDriveBackupEnabled,
				syncInactivityMinutes
			});

			const hadFolderId = settings?.googleDriveBackupFolderId;
			if (googleDriveBackupEnabled && !hadFolderId) {
				try {
					await settingsStore.initializeDrive();
				} catch {
					appStore.showError(
						'Failed to initialize Google Drive. Make sure your Google account has Drive access.'
					);
				}
			}

			await settingsStore.update({
				unitPreferences: {
					distanceUnit,
					volumeUnit,
					chargeUnit
				},
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				googleDriveBackupRetentionCount,
				googleDriveCustomFolderName: googleDriveCustomFolderName || null
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

	// --- Backup ---
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

	// --- File restore ---
	function handleRestoreClick() {
		showRestoreDialog = true;
		restorePreview = null;
		restoreConflicts = [];
		selectedFile = null;
		restoreMode = 'replace';
	}

	async function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			selectedFile = target.files[0] || null;
			if (selectedFile) {
				isRestoring = true;
				try {
					const result = await settingsStore.uploadBackup(selectedFile, 'preview');
					const data = result?.data || result;
					if (data.success && data.preview) restorePreview = data.preview;
					if (data.conflicts && data.conflicts.length > 0) restoreConflicts = data.conflicts;
				} catch (error) {
					appStore.showError(error instanceof Error ? error.message : 'Failed to preview backup');
				} finally {
					isRestoring = false;
				}
			}
		} else {
			selectedFile = null;
			restorePreview = null;
			restoreConflicts = [];
		}
	}

	async function handleRestoreExecute() {
		if (!selectedFile) return;
		isRestoring = true;
		try {
			const result = await settingsStore.uploadBackup(selectedFile, restoreMode);
			const data = result?.data || result;
			if (data.success && data.imported) {
				const imported = data.imported as Record<string, number>;
				const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
				appStore.showSuccess(`Successfully restored ${total} records`);
				showRestoreDialog = false;
				selectedFile = null;
				restorePreview = null;
				restoreConflicts = [];
			}
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to restore backup');
		} finally {
			isRestoring = false;
		}
	}

	// --- Drive restore ---
	async function handleRestoreFromDriveClick() {
		showDriveRestoreDialog = true;
		selectedDriveBackup = null;
		restorePreview = null;
		restoreConflicts = [];
		restoreMode = 'replace';
		isLoadingBackups = true;
		try {
			const backups = await settingsStore.listBackups();
			driveBackups = (Array.isArray(backups) ? backups : []).map(b => ({
				fileId: b.fileId,
				fileName: b.fileName,
				size: b.size,
				createdTime: b.createdTime,
				modifiedTime: b.modifiedTime
			}));
		} catch (error) {
			appStore.showError(
				error instanceof Error ? error.message : 'Failed to load backups from Google Drive'
			);
		} finally {
			isLoadingBackups = false;
		}
	}

	async function handleDriveBackupSelect(fileId: string) {
		selectedDriveBackup = fileId;
		restorePreview = null;
		restoreConflicts = [];
		isRestoring = true;
		try {
			const result = await settingsStore.restoreFromDriveBackup(fileId, 'preview');
			const data = result?.data || result;
			if (data.success && data.preview) restorePreview = data.preview;
			if (data.conflicts && data.conflicts.length > 0) restoreConflicts = data.conflicts;
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to preview backup');
		} finally {
			isRestoring = false;
		}
	}

	async function handleDriveRestoreExecute() {
		if (!selectedDriveBackup) return;
		isRestoring = true;
		try {
			const result = await settingsStore.restoreFromDriveBackup(selectedDriveBackup, restoreMode);
			const data = result?.data || result;
			if (data.success && data.imported) {
				const imported = data.imported as Record<string, number>;
				const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
				appStore.showSuccess(`Successfully restored ${total} records`);
				showDriveRestoreDialog = false;
				selectedDriveBackup = null;
				restorePreview = null;
				restoreConflicts = [];
			}
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to restore backup');
		} finally {
			isRestoring = false;
		}
	}

	// --- Sheets restore ---
	function handleRestoreFromSheetsClick() {
		showSheetsRestoreDialog = true;
		sheetsRestorePreview = null;
		sheetsRestoreConflicts = [];
		sheetsRestoreMode = 'replace';
	}

	async function handleSheetsRestorePreview() {
		isRestoring = true;
		try {
			const idempotencyKey = `restore-sheets-preview-${Date.now()}`;
			const result = await settingsApi.restoreFromSheets('preview', idempotencyKey);
			const data = result?.data || result;
			if (data.success && data.preview) sheetsRestorePreview = data.preview;
			if (data.conflicts && data.conflicts.length > 0) sheetsRestoreConflicts = data.conflicts;
		} catch (error) {
			const validationErrors = extractValidationErrors(error);
			if (validationErrors) {
				appStore.showError(`Google Sheets validation failed:\n${validationErrors}`);
			} else {
				appStore.showError(
					error instanceof Error ? error.message : 'Failed to preview Google Sheets data'
				);
			}
		} finally {
			isRestoring = false;
		}
	}

	async function handleSheetsRestoreExecute() {
		isRestoring = true;
		try {
			const idempotencyKey = `restore-sheets-${sheetsRestoreMode}-${Date.now()}`;
			const result = await settingsApi.restoreFromSheets(sheetsRestoreMode, idempotencyKey);
			const data = result?.data || result;
			if (data.success && data.imported) {
				const imported = data.imported as Record<string, number>;
				const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
				appStore.showSuccess(`Successfully restored ${total} records from Google Sheets`);
				showSheetsRestoreDialog = false;
				sheetsRestorePreview = null;
				sheetsRestoreConflicts = [];
			}
		} catch (error) {
			appStore.showError(
				error instanceof Error ? error.message : 'Failed to restore from Google Sheets'
			);
		} finally {
			isRestoring = false;
		}
	}

	// --- Backup now ---
	function handleBackupNowClick() {
		syncSheets = googleSheetsSyncEnabled;
		syncBackup = googleDriveBackupEnabled;
		syncResults = null;
		showBackupDialog = true;
	}

	async function handleBackupExecute() {
		isSyncing = true;
		syncResults = null;
		try {
			const syncTypes: ('sheets' | 'backup')[] = [];
			if (syncSheets) syncTypes.push('sheets');
			if (syncBackup) syncTypes.push('backup');

			if (syncTypes.length === 0) {
				appStore.showError('Please select at least one backup type');
				return;
			}

			const result = await settingsStore.executeSync(syncTypes, true);
			syncResults = result;

			const results = result?.data?.results;
			if (!results) return;

			const successMessages: string[] = [];
			let hasAuthError = false;

			for (const [type, typeResult] of Object.entries(results) as [
				string,
				{ success: boolean; message?: string; skipped?: boolean }
			][]) {
				if (typeResult.success && !typeResult.skipped) {
					successMessages.push(type === 'sheets' ? 'Google Sheets' : 'Google Drive');
				} else if (!typeResult.success) {
					const typeName = type === 'sheets' ? 'Google Sheets' : 'Google Drive';
					appStore.showError(`${typeName}: ${typeResult.message || 'Failed'}`);
					if (typeResult.message?.includes('re-authenticate')) hasAuthError = true;
				}
			}

			if (hasAuthError) {
				appStore.showError(
					'Google Drive access expired. Click "Re-authenticate with Google" below.'
				);
			}
			if (successMessages.length > 0) {
				appStore.showSuccess(`Successfully backed up to ${successMessages.join(' and ')}`);
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to execute backup');
		} finally {
			isSyncing = false;
		}
	}

	function handleReauthenticate() {
		window.location.href = '/api/v1/auth/reauth/google';
	}
</script>

<div class="max-w-4xl mx-auto">
	{#snippet profileContent()}
		<div class="space-y-6">
			<!-- Identity -->
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<CircleUser class="h-5 w-5 text-muted-foreground" />
							<CardTitle>Identity</CardTitle>
						</div>
						<Badge variant="secondary">Coming Soon</Badge>
					</div>
					<CardDescription>Your account details and personal information</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="flex items-center gap-4 mb-6">
						<Avatar class="h-16 w-16">
							<AvatarFallback class="text-lg">{initials}</AvatarFallback>
						</Avatar>
						<div>
							<p class="text-lg font-semibold">{user?.displayName ?? 'Unknown'}</p>
							<p class="text-sm text-muted-foreground">{user?.email ?? ''}</p>
						</div>
					</div>
					<Separator class="mb-4" />
					<div class="space-y-3 opacity-50">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<CircleUser class="h-4 w-4" />
								<span>Display Name</span>
							</div>
							<span class="text-sm text-muted-foreground">Edit coming soon</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Mail class="h-4 w-4" />
								<span>Email</span>
							</div>
							<span class="text-sm text-muted-foreground">Linked to OAuth</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Calendar class="h-4 w-4" />
								<span>Member Since</span>
							</div>
							<span class="text-sm">{memberSince || '—'}</span>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Connected Accounts -->
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Link2 class="h-5 w-5 text-muted-foreground" />
							<CardTitle>Connected Accounts</CardTitle>
						</div>
						<Badge variant="secondary">Coming Soon</Badge>
					</div>
					<CardDescription>Manage linked services and OAuth providers</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-3 opacity-50">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
									<svg class="h-5 w-5" viewBox="0 0 24 24">
										<path
											d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
											fill="#4285F4"
										/>
										<path
											d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
											fill="#34A853"
										/>
										<path
											d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
											fill="#FBBC05"
										/>
										<path
											d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
											fill="#EA4335"
										/>
									</svg>
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
					</div>
				</CardContent>
			</Card>

			<!-- Sessions -->
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Monitor class="h-5 w-5 text-muted-foreground" />
							<CardTitle>Sessions</CardTitle>
						</div>
						<Badge variant="secondary">Coming Soon</Badge>
					</div>
					<CardDescription>View and manage your active sessions</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-3 opacity-50">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Monitor class="h-4 w-4" />
								<span>Active sessions</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Clock class="h-4 w-4" />
								<span>Last login</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<LogOut class="h-4 w-4" />
								<span>Sign out other devices</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Data & Privacy -->
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Shield class="h-5 w-5 text-muted-foreground" />
							<CardTitle>Data & Privacy</CardTitle>
						</div>
						<Badge variant="secondary">Coming Soon</Badge>
					</div>
					<CardDescription>Control your data and privacy preferences</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-3 opacity-50">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Download class="h-4 w-4" />
								<span>Export all data</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Trash2 class="h-4 w-4" />
								<span>Delete account</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Shield class="h-4 w-4" />
								<span>Data retention preferences</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Sharing -->
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Users class="h-5 w-5 text-muted-foreground" />
							<CardTitle>Sharing</CardTitle>
						</div>
						<Badge variant="secondary">Coming Soon</Badge>
					</div>
					<CardDescription>Household access and shared vehicles</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-3 opacity-50">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<UserPlus class="h-4 w-4" />
								<span>Invite household member</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Users class="h-4 w-4" />
								<span>Manage shared access</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Notifications -->
			<Card>
				<CardHeader>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Bell class="h-5 w-5 text-muted-foreground" />
							<CardTitle>Notifications</CardTitle>
						</div>
						<Badge variant="secondary">Coming Soon</Badge>
					</div>
					<CardDescription>Reminders and alert preferences</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-3 opacity-50">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Bell class="h-4 w-4" />
								<span>Payment reminders</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Bell class="h-4 w-4" />
								<span>Maintenance reminders</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Bell class="h-4 w-4" />
								<span>Backup failure alerts</span>
							</div>
							<span class="text-sm text-muted-foreground">—</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	{/snippet}

	{#if activeView === 'profile'}
		<!-- Profile sub-view -->
		<div class="mb-6">
			<button
				type="button"
				class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
				onclick={() => (activeView = 'settings')}
			>
				<ArrowLeft class="h-4 w-4" />
				Back to Settings
			</button>
			<h1 class="text-2xl font-bold tracking-tight">Profile</h1>
			<p class="text-muted-foreground">Manage your account and personal preferences</p>
		</div>

		{@render profileContent()}
	{:else}
		<!-- Settings main view -->
		<div class="mb-6">
			<h1 class="text-3xl font-bold text-foreground flex items-center gap-3">
				<SettingsIcon class="h-8 w-8 text-primary" />
				Settings
			</h1>
			<p class="text-muted-foreground mt-2">Manage your preferences and data</p>
		</div>

		{#if isLoading}
			<div class="flex items-center justify-center py-12">
				<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
			</div>
		{:else}
			<div class="space-y-6 pb-32 sm:pb-24">
				<!-- Profile card link -->
				<button type="button" class="w-full text-left" onclick={() => (activeView = 'profile')}>
					<Card class="hover:bg-accent/50 transition-colors cursor-pointer">
						<CardContent class="flex items-center gap-4 py-5">
							<Avatar class="h-12 w-12">
								<AvatarFallback class="bg-primary/10 text-primary text-sm font-medium">
									{initials}
								</AvatarFallback>
							</Avatar>
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

				<BackupSyncCard
					{settings}
					{isBackingUp}
					bind:googleDriveBackupEnabled
					bind:googleDriveBackupRetentionCount
					bind:googleDriveCustomFolderName
					bind:googleSheetsSyncEnabled
					bind:syncInactivityMinutes
					onBackup={handleBackup}
					onRestoreClick={handleRestoreClick}
					onRestoreFromDriveClick={handleRestoreFromDriveClick}
					onRestoreFromSheetsClick={handleRestoreFromSheetsClick}
					onBackupNowClick={handleBackupNowClick}
					onReauthenticate={handleReauthenticate}
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

	<RestoreDialog
		bind:open={showRestoreDialog}
		source="file"
		{isRestoring}
		bind:restoreMode
		{restorePreview}
		{restoreConflicts}
		{selectedFile}
		onFileSelect={handleFileSelect}
		onRestore={handleRestoreExecute}
	/>

	<RestoreDialog
		bind:open={showDriveRestoreDialog}
		source="drive"
		{isRestoring}
		bind:restoreMode
		{restorePreview}
		{restoreConflicts}
		{isLoadingBackups}
		{driveBackups}
		selectedBackupId={selectedDriveBackup}
		onBackupSelect={handleDriveBackupSelect}
		onRestore={handleDriveRestoreExecute}
	/>

	<BackupNowDialog
		bind:open={showBackupDialog}
		{isSyncing}
		bind:syncSheets
		bind:syncBackup
		{googleSheetsSyncEnabled}
		{googleDriveBackupEnabled}
		{syncResults}
		onSync={handleBackupExecute}
	/>

	<RestoreDialog
		bind:open={showSheetsRestoreDialog}
		source="sheets"
		{isRestoring}
		bind:restoreMode={sheetsRestoreMode}
		restorePreview={sheetsRestorePreview}
		restoreConflicts={sheetsRestoreConflicts}
		onPreview={handleSheetsRestorePreview}
		onRestore={handleSheetsRestoreExecute}
	/>
</div>
