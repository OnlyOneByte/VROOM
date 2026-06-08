<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { authStore } from '$lib/stores/auth.svelte';
	import { authApi } from '$lib/services/auth-api';
	import { getApiBaseUrl } from '$lib/services/api-client';
	import type { LinkedAuthProvider } from '$lib/types';
	import type { Component } from 'svelte';
	import {
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
		Clock,
		LoaderCircle,
		Unlink,
		CircleAlert,
		CircleCheck,
		LogIn
	} from '@lucide/svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Separator } from '$lib/components/ui/separator';
	import { appStore } from '$lib/stores/app.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { Pencil, Check, X } from '@lucide/svelte';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import ComingSoonCard from '$lib/components/common/coming-soon-card.svelte';
	import GoogleLogo from '$lib/components/icons/GoogleLogo.svelte';
	import GitHubLogo from '$lib/components/icons/GitHubLogo.svelte';

	const iconMap: Record<string, Component<{ class?: string }>> = {
		google: GoogleLogo,
		github: GitHubLogo
	};

	const linkErrorMessages: Record<string, string> = {
		account_conflict: 'This account is already linked to a different user.',
		already_linked: 'This account is already linked to your profile.',
		cancelled: 'Linking was cancelled.'
	};

	const successMessages: Record<string, string> = {
		linked: 'Account linked successfully.'
	};

	let user = $derived(authStore.user);

	let accounts = $state<LinkedAuthProvider[]>([]);
	let providers = $state<{ id: string; displayName: string }[]>([]);
	let isLoadingAccounts = $state(true);
	let unlinkingId = $state<string | null>(null);
	let unlinkError = $state<string | null>(null);
	let linkingProvider = $state<string | null>(null);

	// --- Display name editing ---
	let isEditingName = $state(false);
	let nameDraft = $state('');
	let isSavingName = $state(false);

	function startEditName() {
		nameDraft = user?.displayName ?? '';
		isEditingName = true;
	}

	function cancelEditName() {
		isEditingName = false;
	}

	async function saveDisplayName() {
		const trimmed = nameDraft.trim();
		if (trimmed.length < 1 || trimmed.length > 100) {
			appStore.showError('Display name must be between 1 and 100 characters');
			return;
		}
		if (trimmed === user?.displayName) {
			isEditingName = false;
			return;
		}
		isSavingName = true;
		try {
			await authStore.updateDisplayName(trimmed);
			appStore.showSuccess('Display name updated');
			isEditingName = false;
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to update display name:', err);
			appStore.showError('Failed to update display name');
		} finally {
			isSavingName = false;
		}
	}

	const linkError = $derived(page.url.searchParams.get('link_error'));
	const linkErrorMessage = $derived(linkError ? (linkErrorMessages[linkError] ?? null) : null);
	const successParam = $derived(page.url.searchParams.get('success'));
	const successMessage = $derived(successParam ? (successMessages[successParam] ?? null) : null);

	const linkedProviderTypes = $derived(new Set(accounts.map(a => a.providerType)));
	const unlinkableProviders = $derived(providers.filter(p => !linkedProviderTypes.has(p.id)));

	let initials = $derived.by(() => {
		if (!user?.displayName) return '?';
		return user.displayName
			.split(' ')
			.map(n => n[0])
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

	onMount(async () => {
		try {
			const [fetchedAccounts, fetchedProviders] = await Promise.all([
				authApi.getLinkedAccounts(),
				authApi.getProviders()
			]);
			accounts = fetchedAccounts;
			providers = fetchedProviders;
		} catch {
			// Silently handle — accounts will show empty
		} finally {
			isLoadingAccounts = false;
		}
	});

	async function handleUnlink(id: string) {
		unlinkingId = id;
		unlinkError = null;
		try {
			await authApi.unlinkAccount(id);
			accounts = accounts.filter(a => a.id !== id);
		} catch (err) {
			const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
			if (code === 'LAST_ACCOUNT') {
				unlinkError = 'Cannot unlink your last sign-in method.';
			} else {
				unlinkError = 'Failed to unlink account. Please try again.';
			}
		} finally {
			unlinkingId = null;
		}
	}

	function handleLink(providerId: string) {
		if (browser) {
			linkingProvider = providerId;
			window.location.href = `${getApiBaseUrl()}/api/v1/auth/link/${providerId}`;
		}
	}

	// --- Export all data ---
	let isExporting = $state(false);

	async function handleExportData() {
		isExporting = true;
		try {
			await settingsStore.downloadBackup();
			appStore.showSuccess('Data export downloaded');
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to export data:', err);
			appStore.showError('Failed to export data');
		} finally {
			isExporting = false;
		}
	}
</script>

<svelte:head>
	<title>Profile - VROOM</title>
	<meta name="description" content="Manage your profile and account" />
</svelte:head>

<FormLayout>
	<div class="space-y-6">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Profile</h1>
			<p class="text-muted-foreground">Manage your account and personal preferences</p>
		</div>

		<!-- Identity -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<CircleUser class="h-5 w-5 text-muted-foreground" />
					<CardTitle>Identity</CardTitle>
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
				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
							<CircleUser class="h-4 w-4" />
							<span>Display Name</span>
						</div>
						{#if isEditingName}
							<div class="flex items-center gap-2 flex-1 justify-end">
								<Input
									bind:value={nameDraft}
									maxlength={100}
									class="h-8 max-w-[200px]"
									disabled={isSavingName}
									aria-label="Display name"
									onkeydown={(e: KeyboardEvent) => {
										if (e.key === 'Enter') saveDisplayName();
										if (e.key === 'Escape') cancelEditName();
									}}
								/>
								<Button
									size="sm"
									variant="ghost"
									onclick={saveDisplayName}
									disabled={isSavingName}
									aria-label="Save display name"
								>
									{#if isSavingName}
										<LoaderCircle class="h-4 w-4 animate-spin" />
									{:else}
										<Check class="h-4 w-4" />
									{/if}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onclick={cancelEditName}
									disabled={isSavingName}
									aria-label="Cancel editing"
								>
									<X class="h-4 w-4" />
								</Button>
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<span class="text-sm">{user?.displayName ?? '—'}</span>
								<Button
									size="sm"
									variant="ghost"
									onclick={startEditName}
									aria-label="Edit display name"
								>
									<Pencil class="h-3.5 w-3.5" />
								</Button>
							</div>
						{/if}
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Mail class="h-4 w-4" />
							<span>Email</span>
						</div>
						<span class="text-sm">{user?.email ?? '—'}</span>
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

		<!-- Link Error / Success Messages -->
		{#if linkErrorMessage}
			<div
				class="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
			>
				<CircleAlert class="h-5 w-5 text-destructive shrink-0 mt-0.5" />
				<p class="text-sm text-destructive">{linkErrorMessage}</p>
			</div>
		{/if}
		{#if successMessage}
			<!-- Icon keeps the chart-2 "success" hue (graphical, exempt) + the tint bg;
			     the TEXT is text-foreground because chart-2 on its own 10% tint is ~3.26:1,
			     below WCAG AA 4.5:1 for this small text (cycle 187-189 class). -->
			<div class="flex items-start gap-3 rounded-lg border border-chart-2/50 bg-chart-2/10 p-4">
				<CircleCheck class="h-5 w-5 text-chart-2 shrink-0 mt-0.5" />
				<p class="text-sm text-foreground">{successMessage}</p>
			</div>
		{/if}

		<!-- Connected Accounts -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Link2 class="h-5 w-5 text-muted-foreground" />
					<CardTitle>Connected Accounts</CardTitle>
				</div>
				<CardDescription>Manage your linked sign-in methods</CardDescription>
			</CardHeader>
			<CardContent>
				{#if unlinkError}
					<div
						class="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 mb-3"
					>
						<CircleAlert class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
						<p class="text-sm text-destructive">{unlinkError}</p>
					</div>
				{/if}
				{#if isLoadingAccounts}
					<div class="flex items-center justify-center py-6">
						<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{:else}
					<div class="space-y-3">
						{#each accounts as account (account.id)}
							{@const IconComponent = iconMap[account.providerType]}
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
										{#if IconComponent}
											<IconComponent class="h-5 w-5" />
										{:else}
											<LogIn class="h-5 w-5 text-muted-foreground" />
										{/if}
									</div>
									<div>
										<p class="text-sm font-medium">{account.displayName}</p>
										<p class="text-xs text-muted-foreground">{account.email}</p>
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									aria-label="Unlink {account.displayName}"
									disabled={accounts.length <= 1 || unlinkingId !== null}
									onclick={() => handleUnlink(account.id)}
								>
									{#if unlinkingId === account.id}
										<LoaderCircle class="h-4 w-4 animate-spin" />
									{:else}
										<Unlink class="h-4 w-4" />
									{/if}
								</Button>
							</div>
						{/each}

						{#if unlinkableProviders.length > 0}
							<Separator />
							<div class="space-y-2">
								<p class="text-sm text-muted-foreground">Link another account</p>
								{#each unlinkableProviders as provider (provider.id)}
									{@const ProviderIcon = iconMap[provider.id]}
									<Button
										variant="outline"
										size="sm"
										class="w-full justify-start"
										disabled={linkingProvider !== null}
										onclick={() => handleLink(provider.id)}
									>
										{#if linkingProvider === provider.id}
											<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
											Linking...
										{:else}
											{#if ProviderIcon}
												<ProviderIcon class="mr-2 h-4 w-4" />
											{:else}
												<LogIn class="mr-2 h-4 w-4" />
											{/if}
											Link {provider.displayName}
										{/if}
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Sessions -->
		<ComingSoonCard
			icon={Monitor}
			title="Sessions"
			description="View and manage your active sessions"
			items={[
				{ icon: Monitor, label: 'Active sessions' },
				{ icon: Clock, label: 'Last login' },
				{ icon: LogOut, label: 'Sign out other devices' }
			]}
		/>

		<!-- Data & Privacy -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Shield class="h-5 w-5 text-muted-foreground" />
					<CardTitle>Data & Privacy</CardTitle>
				</div>
				<CardDescription>Control your data and privacy preferences</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<!-- Export all data (live) -->
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-2 text-sm">
						<Download class="h-4 w-4 text-muted-foreground" />
						<div>
							<p>Export all data</p>
							<p class="text-xs text-muted-foreground">
								Download a ZIP of your data. Images and photos are not included.
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						onclick={handleExportData}
						disabled={isExporting}
					>
						{#if isExporting}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
							Exporting...
						{:else}
							<Download class="mr-2 h-4 w-4" />
							Export
						{/if}
					</Button>
				</div>
				<Separator />
				<!-- Delete account (not yet available — destructive, needs confirm flow).
				     No opacity-50: dimming muted text drops it below WCAG AA contrast.
				     Full-opacity muted-foreground (~5:1) reads as secondary while staying
				     accessible; the "Coming soon" pill carries the disabled state. -->
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Trash2 class="h-4 w-4" />
						<span>Delete account</span>
					</div>
					<span class="text-xs text-muted-foreground">Coming soon</span>
				</div>
			</CardContent>
		</Card>

		<!-- Sharing -->
		<ComingSoonCard
			icon={Users}
			title="Sharing"
			description="Household access and shared vehicles"
			items={[
				{ icon: UserPlus, label: 'Invite household member' },
				{ icon: Users, label: 'Manage shared access' }
			]}
		/>

		<!-- Notifications -->
		<ComingSoonCard
			icon={Bell}
			title="Notifications"
			description="Reminders and alert preferences"
			items={[
				{ icon: Bell, label: 'Payment reminders' },
				{ icon: Bell, label: 'Maintenance reminders' },
				{ icon: Bell, label: 'Backup failure alerts' }
			]}
		/>
	</div>
</FormLayout>
